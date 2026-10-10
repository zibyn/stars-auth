package login_test

import (
	"context"
	"encoding/json"
	"html"
	"net/url"
	"strings"
	"testing"

	"github.com/zibyn/stars-auth/internal/passkey"
	"github.com/zibyn/stars-auth/internal/passkey/passkeytest"
)

// optionsOf pulls the assertion options embedded in the login page, and says
// whether the page carries them at all.
func optionsOf(t *testing.T, page string) (json.RawMessage, bool) {
	t.Helper()
	const open, close = `<script type="application/json" id="passkey-options">`, "</script>"
	i := strings.Index(page, open)
	if i < 0 {
		return nil, false
	}
	rest := page[i+len(open):]
	j := strings.Index(rest, close)
	if j < 0 {
		t.Fatalf("passkey options run to the end of the page")
	}
	return json.RawMessage(rest[:j]), true
}

// passkeyUser signs ALICE in with the phone code once, giving the sub a
// Passkey of a's through the account center's store.
func passkeyUser(t *testing.T, e *env, a *passkeytest.Authenticator) string {
	t.Helper()
	sub, err := e.ids.SignIn(context.Background(), "phone", "+8613800138000")
	if err != nil {
		t.Fatal(err)
	}
	// The account center's registration challenge hangs off its Session.
	if _, err := e.pool.Exec(context.Background(),
		"INSERT INTO sessions (id, id_hash, user_id, auth_time, amr) VALUES ('pk-enroll', '\x02', $1, now(), '{}')", sub); err != nil {
		t.Fatal(err)
	}
	store, err := passkey.New(e.pool, e.issuer)
	if err != nil {
		t.Fatal(err)
	}
	a.Origin = e.issuer
	a.UserHandle = []byte(sub)
	options, err := store.Begin(context.Background(), sub, sub, "pk-enroll")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Finish(context.Background(), sub, "pk-enroll", a.Enroll(options)); err != nil {
		t.Fatal(err)
	}
	return sub
}

// The first step of the login page carries assertion options, its identifier
// field says it takes a Passkey, and the password form carries none; a
// Passkey then signs its User in with no code, no password and no TOTP.
func TestPasskeyLogin(t *testing.T) {
	e := start(t)
	a := passkeytest.New(t)
	sub := passkeyUser(t, e, a)

	_, page := e.authorize("")
	options, ok := optionsOf(t, page)
	if !ok {
		t.Fatal("no passkey options on the first step")
	}
	if !strings.Contains(page, `autocomplete="username webauthn"`) ||
		!strings.Contains(page, `id="passkey-login" hidden`) {
		t.Fatal("the identifier field or the button is missing")
	}
	// The password form is a first step too — an instance with no Channels
	// offers nothing else — so it carries the options as well. A visit of
	// its own: rendering any first step renews the challenge.
	_, other := e.authorize("")
	m := actionRE.FindStringSubmatch(other)
	if m == nil {
		t.Fatal("no form on the page")
	}
	_, pw := e.do("GET", html.UnescapeString(m[1])+"?password", nil)
	if _, ok := optionsOf(t, pw); !ok {
		t.Fatal("no options on the password form")
	}
	if !strings.Contains(pw, `autocomplete="username webauthn"`) {
		t.Fatal("the password form's username field lacks the webauthn hint")
	}

	a.SignCount = 2
	resp, page := e.post(page, url.Values{"op": {"passkey"}, "passkey": {string(a.Assert(options))}})
	if resp.StatusCode/100 != 3 {
		t.Fatalf("passkey login: %d %s", resp.StatusCode, page)
	}
	claims := e.idToken(e.code(resp))
	if amr, _ := claims["amr"].([]any); len(amr) != 2 || amr[0] != "hwk" || amr[1] != "mfa" {
		t.Fatalf("amr: %v", claims["amr"])
	}

	// The sign-in marked the Passkey used.
	var signCount int64
	if err := e.pool.QueryRow(context.Background(),
		"SELECT sign_count FROM passkeys WHERE user_id = $1", sub).Scan(&signCount); err != nil {
		t.Fatal(err)
	}
	if signCount != 2 {
		t.Fatalf("sign_count: %d", signCount)
	}
}

// A synced Passkey is a software key in the amr claim.
func TestPasskeyLoginSynced(t *testing.T) {
	e := start(t)
	a := passkeytest.New(t)
	a.BE, a.BS = true, true
	passkeyUser(t, e, a)

	_, page := e.authorize("")
	options, _ := optionsOf(t, page)
	a.SignCount = 1
	resp, page := e.post(page, url.Values{"op": {"passkey"}, "passkey": {string(a.Assert(options))}})
	if resp.StatusCode/100 != 3 {
		t.Fatalf("passkey login: %d %s", resp.StatusCode, page)
	}
	claims := e.idToken(e.code(resp))
	if amr, _ := claims["amr"].([]any); len(amr) != 2 || amr[0] != "swk" || amr[1] != "mfa" {
		t.Fatalf("amr: %v", claims["amr"])
	}
}

// 两步验证 asks a code login for a TOTP, but a Passkey has passed it
// already.
func TestPasskeyLoginPastTOTP(t *testing.T) {
	e := start(t)
	a := passkeytest.New(t)
	sub := passkeyUser(t, e, a)
	e.twoFactor(sub)

	_, page := e.authorize("")
	options, _ := optionsOf(t, page)
	a.SignCount = 1
	resp, page := e.post(page, url.Values{"op": {"passkey"}, "passkey": {string(a.Assert(options))}})
	if resp.StatusCode/100 != 3 {
		t.Fatalf("passkey login past TOTP: %d %s", resp.StatusCode, page)
	}
}

// The terms are still asked: the assertion's form is the page's own script,
// which ticked no box, so the consent step comes after the Passkey signs the
// User in.
func TestPasskeyLoginThenConsent(t *testing.T) {
	e := start(t)
	a := passkeytest.New(t)
	sub := passkeyUser(t, e, a)
	e.setTerms("v1")

	_, page := e.authorize("")
	options, _ := optionsOf(t, page)
	a.SignCount = 1
	resp, page := e.post(page, url.Values{"op": {"passkey"}, "passkey": {string(a.Assert(options))}})
	if resp.StatusCode != 200 || !strings.Contains(page, `name="agree" value="v1" required`) {
		t.Fatalf("the consent step did not come: %d %s", resp.StatusCode, page)
	}
	if got := e.consents(sub); len(got) != 0 {
		t.Fatalf("consents recorded without a ticked box: %v", got)
	}
	resp, _ = e.post(page, url.Values{"op": {"consent"}, "agree": {"v1"}})
	claims := e.idToken(e.code(resp))
	if claims["sub"] != sub {
		t.Fatalf("sub: %v", claims["sub"])
	}
	if got := e.consents(sub); len(got) != 1 || got[0] != "v1@"+clientID {
		t.Fatalf("consents: %v", got)
	}
}

// A refused assertion — a credential nobody holds here — shows the User their
// way out and signs nobody in; the next first step carries a fresh challenge,
// so the refused assertion cannot come back.
func TestPasskeyLoginRefused(t *testing.T) {
	e := start(t)
	a := passkeytest.New(t)
	passkeyUser(t, e, a)

	_, page := e.authorize("")
	first, _ := optionsOf(t, page)

	unknown := passkeytest.New(t)
	unknown.Origin, unknown.UserHandle = a.Origin, a.UserHandle
	resp, page := e.post(page, url.Values{"op": {"passkey"}, "passkey": {string(unknown.Assert(first))}})
	if resp.StatusCode != 200 || !strings.Contains(page, passkey.ErrNoPasskey.Error()) {
		t.Fatalf("an unknown credential: %d %s", resp.StatusCode, page)
	}
	var users int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM users").Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("a refused assertion signed someone in: %d users", users)
	}

	second, _ := optionsOf(t, page)
	if string(first) == string(second) {
		t.Fatal("the challenge was not renewed")
	}
	a.SignCount = 1
	resp, _ = e.post(page, url.Values{"op": {"passkey"}, "passkey": {string(a.Assert(first))}})
	if resp.StatusCode/100 == 3 {
		t.Fatal("the refused page's assertion signed in")
	}
}
