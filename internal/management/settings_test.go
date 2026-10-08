package management_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/zibyn/stars-auth/internal/management"
	"github.com/zibyn/stars-auth/internal/twofactor"
)

type settings struct {
	PasswordLogin       string `json:"passwordLogin"`
	RequirePhone        bool   `json:"requirePhone"`
	DailySendLimit      int    `json:"dailySendLimit"`
	TermsURL            string `json:"termsUrl"`
	PrivacyURL          string `json:"privacyUrl"`
	TermsVersion        string `json:"termsVersion"`
	AuditRetentionDays  int    `json:"auditRetentionDays"`
	AdminsNeedTwoFactor bool   `json:"adminsNeedTwoFactor"`
}

// twoFactorOn turns 两步验证 on for sub, as the account center does.
func (e *env) twoFactorOn(sub string) {
	e.t.Helper()
	ctx := context.Background()
	s := twofactor.New(e.pool, e.keyring)
	secret, err := s.Begin(ctx, sub)
	if err != nil {
		e.t.Fatal(err)
	}
	key, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	mac := hmac.New(sha1.New, key)
	_ = binary.Write(mac, binary.BigEndian, time.Now().Unix()/30)
	sum := mac.Sum(nil)
	code := fmt.Sprintf("%06d", (binary.BigEndian.Uint32(sum[sum[19]&0xf:])&0x7fffffff)%1_000_000)
	if _, err := s.Confirm(ctx, sub, code); err != nil {
		e.t.Fatal(err)
	}
}

// problem calls GET path and returns the status and the error's code.
func (e *env) problem(token, path string) (int, string) {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.issuer+management.Prefix+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	var body struct{ Code string }
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body.Code
}

// With 管理员必须启用两步验证 on, an admin without 两步验证 is turned away
// from every endpoint, with a code the console knows, until they turn it on.
// No admin turns the switch on without 两步验证 of their own.
func TestAdminsMustUseTwoFactor(t *testing.T) {
	e := start(t)
	e.user("CAROL", []string{"readonly"})
	owner, carol := e.token(e.owner, nil), e.token("CAROL", nil)
	policy := settings{PasswordLogin: "admins", DailySendLimit: 1000, AuditRetentionDays: 180, AdminsNeedTwoFactor: true}

	if code := e.call("PUT", owner, "/settings", policy, nil); code != 422 {
		t.Fatalf("turn on without 两步验证 of one's own: %d, want 422", code)
	}
	e.twoFactorOn(e.owner)
	if code := e.call("PUT", owner, "/settings", policy, nil); code != 204 {
		t.Fatalf("turn on: %d", code)
	}
	var got settings
	if code := e.get(owner, "/settings", &got); code != 200 || got != policy {
		t.Errorf("after turning on: %d %+v", code, got)
	}

	for _, path := range []string{"/me", "/users", "/settings"} {
		if code, err := e.problem(carol, path); code != 403 || err != "two_factor_required" {
			t.Errorf("CAROL without 两步验证, %s: %d %q", path, code, err)
		}
	}
	e.twoFactorOn("CAROL")
	if code := e.get(carol, "/me", nil); code != 200 {
		t.Errorf("CAROL with 两步验证: %d", code)
	}
	// Saving the policy again while the switch is on is fine.
	if code := e.call("PUT", owner, "/settings", policy, nil); code != 204 {
		t.Errorf("save while on: %d", code)
	}
}

func TestAdminChangesLoginPolicy(t *testing.T) {
	e := start(t)
	e.user("RO", []string{"readonly"})
	owner, ro := e.token(e.owner, nil), e.token("RO", nil)

	var got settings
	if code := e.get(ro, "/settings", &got); code != 200 || got != (settings{PasswordLogin: "admins", DailySendLimit: 1000, AuditRetentionDays: 180}) {
		t.Fatalf("defaults: %d %+v", code, got)
	}
	want := settings{
		PasswordLogin: "all", RequirePhone: true, DailySendLimit: 50,
		TermsURL: "https://example.com/terms", PrivacyURL: "https://example.com/privacy", TermsVersion: "2026-10",
		AuditRetentionDays: 30,
	}
	if code := e.call("PUT", ro, "/settings", want, nil); code != 403 {
		t.Errorf("readonly PUT: %d, want 403", code)
	}
	if code := e.call("PUT", owner, "/settings", want, nil); code != 204 {
		t.Fatalf("PUT: %d", code)
	}
	if code := e.get(ro, "/settings", &got); code != 200 || got != want {
		t.Errorf("after PUT: %d %+v", code, got)
	}

	for name, bad := range map[string]settings{
		"version without URLs": {PasswordLogin: "all", DailySendLimit: 1, AuditRetentionDays: 1, TermsVersion: "1"},
		"URL not https":        {PasswordLogin: "all", DailySendLimit: 1, AuditRetentionDays: 1, TermsVersion: "1", TermsURL: "http://x", PrivacyURL: "https://x"},
		"URL without version":  {PasswordLogin: "all", DailySendLimit: 1, AuditRetentionDays: 1, TermsURL: "javascript:alert(1)"},
		"no retention":         {PasswordLogin: "all", DailySendLimit: 1},
		"unknown password":     {PasswordLogin: "some", DailySendLimit: 1, AuditRetentionDays: 1},
	} {
		if code := e.call("PUT", owner, "/settings", bad, nil); code != 422 {
			t.Errorf("%s: %d, want 422", name, code)
		}
	}
}

func TestOwnerRotatesSigningKeys(t *testing.T) {
	e := start(t)
	e.user("ADMIN", []string{"admin"})
	owner, admin := e.token(e.owner, nil), e.token("ADMIN", nil)

	type key struct {
		Kid     string
		Current bool
	}
	var before, after struct{ Keys []key }
	if code := e.get(admin, "/signing-keys", &before); code != 200 || len(before.Keys) != 1 || !before.Keys[0].Current {
		t.Fatalf("keys: %d %+v", code, before)
	}
	if code := e.call("POST", admin, "/signing-keys/rotate", nil, nil); code != 403 {
		t.Errorf("admin rotates: %d, want 403", code)
	}
	if code := e.call("POST", owner, "/signing-keys/rotate", nil, nil); code != 204 {
		t.Fatalf("rotate: %d", code)
	}
	if code := e.get(admin, "/signing-keys", &after); code != 200 || len(after.Keys) != 2 ||
		!after.Keys[0].Current || after.Keys[1] != (key{Kid: before.Keys[0].Kid}) {
		t.Errorf("after rotate: %d %+v", code, after)
	}
	// The token signed before the rotation still works.
	if code := e.get(owner, "/me", nil); code != 200 {
		t.Errorf("old token: %d", code)
	}
}

func TestCleanupKeepsAuditForTheRetentionPeriod(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `UPDATE settings SET audit_retention_days = 30;
		INSERT INTO audit_log (event, at) VALUES ('old', now() - interval '31 days'), ('recent', now() - interval '29 days')`); err != nil {
		t.Fatal(err)
	}
	if err := management.DeleteOldAudit(ctx, e.pool); err != nil {
		t.Fatal(err)
	}
	var events []string
	rows, _ := e.pool.Query(ctx, "SELECT event FROM audit_log WHERE event IN ('old', 'recent')")
	for rows.Next() {
		var ev string
		_ = rows.Scan(&ev)
		events = append(events, ev)
	}
	if len(events) != 1 || events[0] != "recent" {
		t.Errorf("left %v, want [recent]", events)
	}
}
