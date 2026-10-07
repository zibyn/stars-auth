package management_test

import (
	"context"
	"testing"

	"github.com/zibyn/stars-auth/internal/management"
)

type settings struct {
	PasswordLogin      string `json:"passwordLogin"`
	RequirePhone       bool   `json:"requirePhone"`
	DailySendLimit     int    `json:"dailySendLimit"`
	TermsURL           string `json:"termsUrl"`
	PrivacyURL         string `json:"privacyUrl"`
	TermsVersion       string `json:"termsVersion"`
	AuditRetentionDays int    `json:"auditRetentionDays"`
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
