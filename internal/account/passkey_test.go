package account_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/zibyn/stars-auth/internal/passkey/passkeytest"
)

// enroll runs the adding flow for a: creation options, then the software
// authenticator's response. It returns the last status and the added
// Passkey's JSON.
func (e *env) enroll(tok string, a *passkeytest.Authenticator) (int, map[string]any) {
	e.t.Helper()
	var opts struct {
		Options json.RawMessage `json:"options"`
	}
	if code := e.call("POST", tok, "/v1/account/passkeys/options", nil, &opts); code != 200 {
		return code, nil
	}
	var added map[string]any
	return e.call("POST", tok, "/v1/account/passkeys", a.Enroll(opts.Options), &added), added
}

func (e *env) passkeys(tok string) (int, []map[string]any) {
	e.t.Helper()
	var got struct {
		Passkeys []map[string]any `json:"passkeys"`
	}
	code := e.call("GET", tok, "/v1/account/passkeys", nil, &got)
	return code, got.Passkeys
}

// A User adds Passkeys from the account center, names them, and deletes
// them; adding and deleting need a fresh authentication, renaming does not.
func TestPasskeys(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	a := passkeytest.New(t)
	a.Origin = e.issuer
	stale := e.signIn("ALICE", 20*time.Minute)
	tok := e.signIn("ALICE", 0)

	// Adding starts with reauthenticating.
	if code, _ := e.enroll(stale, a); code != 403 {
		t.Fatalf("add without reauthentication: %d", code)
	}
	var opts struct {
		Options struct {
			PublicKey struct {
				Challenge string `json:"challenge"`
				User      struct {
					ID string `json:"id"`
				} `json:"user"`
				RP struct {
					ID string `json:"id"`
				} `json:"rp"`
				AuthenticatorSelection struct {
					ResidentKey      string `json:"residentKey"`
					UserVerification string `json:"userVerification"`
				} `json:"authenticatorSelection"`
				Attestation        string `json:"attestation"`
				ExcludeCredentials []struct {
					ID string `json:"id"`
				} `json:"excludeCredentials"`
			} `json:"publicKey"`
		} `json:"options"`
	}
	if code := e.call("POST", tok, "/v1/account/passkeys/options", nil, &opts); code != 200 {
		t.Fatalf("options: %d", code)
	}
	pk := opts.Options.PublicKey
	rpID, _ := url.Parse(e.issuer)
	if pk.RP.ID != rpID.Hostname() || pk.Challenge == "" ||
		pk.AuthenticatorSelection.ResidentKey != "required" || pk.AuthenticatorSelection.UserVerification != "required" ||
		pk.Attestation != "none" || len(pk.ExcludeCredentials) != 0 {
		t.Fatalf("creation options: %+v", opts)
	}
	// The user handle is the User's sub.
	if handle, err := base64.RawURLEncoding.DecodeString(pk.User.ID); err != nil || string(handle) != "ALICE" {
		t.Fatalf("user handle: %q", pk.User.ID)
	}

	// An unknown authenticator's Passkey is just called Passkey.
	code, added := e.enroll(tok, a)
	if code != 200 || added["name"] != "Passkey" || added["lastUsedAt"] != nil {
		t.Fatalf("add: %d %+v", code, added)
	}
	id := added["id"].(string)
	if code, list := e.passkeys(tok); code != 200 || len(list) != 1 || list[0]["id"] != id ||
		list[0]["createdAt"] == nil {
		t.Fatalf("list: %d %+v", code, list)
	}

	// The next options exclude the credential just added; submitting the
	// same credential again is refused anyway.
	if code := e.call("POST", tok, "/v1/account/passkeys/options", nil, &opts); code != 200 ||
		len(opts.Options.PublicKey.ExcludeCredentials) != 1 {
		t.Fatalf("excludeCredentials: %d %+v", code, opts)
	}
	a.CredentialID = mustDecodeB64(t, opts.Options.PublicKey.ExcludeCredentials[0].ID)
	if code, _ := e.enroll(tok, a); code != 409 {
		t.Fatalf("the same credential again: %d", code)
	}

	// A Passkey's name is its owner's business; no reauthentication.
	if code := e.call("PATCH", stale, "/v1/account/passkeys/"+id, map[string]string{"name": "工作电脑"}, nil); code != 204 {
		t.Fatalf("rename: %d", code)
	}
	if code, list := e.passkeys(tok); code != 200 || len(list) != 1 || list[0]["name"] != "工作电脑" {
		t.Fatalf("list after rename: %d %+v", code, list)
	}
	if code := e.call("PATCH", tok, "/v1/account/passkeys/nope", map[string]string{"name": "x"}, nil); code != 404 {
		t.Errorf("rename a Passkey that is not theirs: %d", code)
	}
	if code := e.call("PATCH", tok, "/v1/account/passkeys/"+id, map[string]string{"name": " "}, nil); code != 422 {
		t.Errorf("rename to nothing: %d", code)
	}

	// Deleting needs reauthentication again.
	if code := e.call("DELETE", stale, "/v1/account/passkeys/"+id, nil, nil); code != 403 {
		t.Fatalf("delete without reauthentication: %d", code)
	}
	if code := e.call("DELETE", tok, "/v1/account/passkeys/"+id, nil, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, list := e.passkeys(tok); code != 200 || len(list) != 0 {
		t.Fatalf("list after delete: %d %+v", code, list)
	}
	if code := e.call("DELETE", tok, "/v1/account/passkeys/"+id, nil, nil); code != 404 {
		t.Errorf("delete again: %d", code)
	}

	// Every change of the list is audited.
	rows, err := e.pool.Query(context.Background(), "SELECT event, detail->>'by', detail->>'name' FROM audit_log WHERE sub = 'ALICE' ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var events [][3]string
	for rows.Next() {
		var ev [3]string
		if err := rows.Scan(&ev[0], &ev[1], &ev[2]); err != nil {
			t.Fatal(err)
		}
		events = append(events, ev)
	}
	want := [][3]string{
		{"passkey.added", "ALICE", "Passkey"}, {"passkey.renamed", "ALICE", "工作电脑"},
		{"passkey.removed", "ALICE", "工作电脑"},
	}
	if len(events) != len(want) {
		t.Fatalf("audit: %+v", events)
	}
	for i, ev := range events {
		if ev != want[i] {
			t.Errorf("audit %d: %v, want %v", i, ev, want[i])
		}
	}
}

// A Passkey without the User Verification flag is refused: a Passkey is
// one because it verifies the User every time.
func TestPasskeyNeedsUserVerification(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	tok := e.signIn("ALICE", 0)
	a := passkeytest.New(t)
	a.Origin, a.UV = e.issuer, false

	if code, _ := e.enroll(tok, a); code != 422 {
		t.Fatalf("add without UV: %d", code)
	}
	if code, list := e.passkeys(tok); code != 200 || len(list) != 0 {
		t.Fatalf("list: %d %+v", code, list)
	}
}

// A Passkey's default name is its authenticator's, from the AAGUID.
func TestPasskeyName(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	tok := e.signIn("ALICE", 0)
	a := passkeytest.New(t)
	a.Origin = e.issuer
	// 1Password's AAGUID.
	u, err := uuid.Parse("bada5566-a7aa-401f-bd96-45619a55120d")
	if err != nil {
		t.Fatal(err)
	}
	a.AAGUID = u
	if code, added := e.enroll(tok, a); code != 200 || added["name"] != "1Password" {
		t.Fatalf("add: %d %+v", code, added)
	}
}

// The challenge is one attempt: a replayed or stale response gets nothing.
func TestPasskeyChallengeIsOneAttempt(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	tok := e.signIn("ALICE", 0)
	a := passkeytest.New(t)
	a.Origin = e.issuer

	var opts struct {
		Options json.RawMessage `json:"options"`
	}
	if code := e.call("POST", tok, "/v1/account/passkeys/options", nil, &opts); code != 200 {
		t.Fatalf("options: %d", code)
	}
	response := a.Enroll(opts.Options)
	if code := e.call("POST", tok, "/v1/account/passkeys", response, nil); code != 200 {
		t.Fatalf("add: %d", code)
	}
	if code := e.call("POST", tok, "/v1/account/passkeys", response, nil); code != 422 {
		t.Fatalf("replay: %d", code)
	}
	if code := e.call("POST", tok, "/v1/account/passkeys", a.Enroll(opts.Options), nil); code != 422 {
		t.Fatalf("challenge reused: %d", code)
	}
}

// Native Apps use the same endpoints with their own bearer token, from a
// Session of their own.
func TestPasskeysFromAnAppSession(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	tok := e.signIn("ALICE", 0)
	if _, err := e.pool.Exec(context.Background(), "UPDATE sessions SET client_id = 'com.example.app'"); err != nil {
		t.Fatal(err)
	}
	a := passkeytest.New(t)
	a.Origin = e.issuer
	if code, added := e.enroll(tok, a); code != 200 || added["name"] != "Passkey" {
		t.Fatalf("add from an App Session: %d %+v", code, added)
	}
}

// /.well-known/passkey-endpoints tells password managers where adding and
// managing Passkeys happens.
func TestPasskeyEndpointsWellKnown(t *testing.T) {
	e := start(t)
	resp, err := http.Get(e.issuer + "/.well-known/passkey-endpoints")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	body, _ := io.ReadAll(resp.Body)
	var got map[string]string
	if resp.StatusCode != 200 || json.Unmarshal(body, &got) != nil ||
		got["enroll"] != e.issuer+"/account#passkeys" || got["manage"] != e.issuer+"/account#passkeys" {
		t.Fatalf("passkey-endpoints: %d %s", resp.StatusCode, body)
	}
}

// mustDecodeB64 decodes a base64url credential ID from options.
func mustDecodeB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
