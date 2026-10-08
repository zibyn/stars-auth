package management_test

import (
	"context"
	"slices"
	"testing"
	"time"

	_ "github.com/zibyn/stars-auth/internal/provider/oidc"
)

type providerField struct {
	Key               string
	Secret, Immutable bool
}

type providers struct {
	Types []struct {
		Key    string
		Fields []providerField
	}
	Providers []providerInfo
}

type providerInfo struct {
	ID, Type, Name string
	Enabled        bool
	Config         map[string]string
	Secrets        map[string]time.Time
	CallbackURL    string
	Bound          int
	OnlyLoginPath  int
}

func (e *env) providers(token string) providers {
	e.t.Helper()
	var got providers
	if code := e.get(token, "/providers", &got); code != 200 {
		e.t.Fatalf("providers: %d", code)
	}
	return got
}

func google(config map[string]string) map[string]any {
	c := map[string]string{"issuer": "https://accounts.google.com", "client_id": "cid", "client_secret": "csecret"}
	for k, v := range config {
		c[k] = v
	}
	return map[string]any{"id": "google", "type": "oidc", "name": "Google", "config": c}
}

func TestAdminAddsAndEditsProvider(t *testing.T) {
	e := start(t)
	e.user("RO", []string{"readonly"})
	owner, ro := e.token(e.owner, nil), e.token("RO", nil)

	got := e.providers(ro)
	i := slices.IndexFunc(got.Types, func(ty struct {
		Key    string
		Fields []providerField
	}) bool {
		return ty.Key == "oidc"
	})
	if len(got.Providers) != 0 || i < 0 || !slices.Equal(got.Types[i].Fields, []providerField{
		{"issuer", false, true}, {"client_id", false, false}, {"client_secret", true, false},
	}) {
		t.Fatalf("before: %+v", got)
	}

	if code := e.call("POST", ro, "/providers", google(nil), nil); code != 403 {
		t.Errorf("readonly adds: %d, want 403", code)
	}
	for name, body := range map[string]map[string]any{
		"bad id":       {"id": "Google!", "type": "oidc", "name": "G", "config": map[string]string{"issuer": "https://a.example", "client_id": "c", "client_secret": "s"}},
		"no secret":    google(map[string]string{"client_secret": ""}),
		"bad issuer":   google(map[string]string{"issuer": "not a url"}),
		"unknown type": {"id": "x", "type": "nope", "name": "X", "config": map[string]string{}},
	} {
		if code := e.call("POST", owner, "/providers", body, nil); code != 422 {
			t.Errorf("%s: %d, want 422", name, code)
		}
	}
	if code := e.call("POST", owner, "/providers", google(nil), nil); code != 204 {
		t.Fatalf("add: %d", code)
	}
	if code := e.call("POST", owner, "/providers", google(nil), nil); code != 409 {
		t.Errorf("same id again: %d, want 409", code)
	}

	got = e.providers(ro)
	if len(got.Providers) != 1 {
		t.Fatalf("after add: %+v", got.Providers)
	}
	p := got.Providers[0]
	if p.ID != "google" || p.Type != "oidc" || p.Name != "Google" || !p.Enabled ||
		p.Config["issuer"] != "https://accounts.google.com" || p.Config["client_id"] != "cid" ||
		p.Config["client_secret"] != "" || p.Secrets["client_secret"].IsZero() ||
		p.CallbackURL != e.issuer+"/login/providers/google/callback" {
		t.Errorf("listed: %+v", p)
	}

	// The name and client_id change; an empty secret keeps the stored one.
	edit := map[string]any{"name": "Google 账号", "config": map[string]string{"issuer": "https://accounts.google.com", "client_id": "cid2"}}
	if code := e.call("PUT", owner, "/providers/google", edit, nil); code != 204 {
		t.Fatalf("edit: %d", code)
	}
	p = e.providers(ro).Providers[0]
	if p.Name != "Google 账号" || p.Config["client_id"] != "cid2" || p.Secrets["client_secret"].IsZero() {
		t.Errorf("edited: %+v", p)
	}
	// The issuer anchors the External Identities, so it never changes.
	edit["config"] = map[string]string{"issuer": "https://evil.example", "client_id": "cid2"}
	if code := e.call("PUT", owner, "/providers/google", edit, nil); code != 422 {
		t.Errorf("issuer changed: %d, want 422", code)
	}
	if code := e.call("PUT", owner, "/providers/nope", edit, nil); code != 404 {
		t.Errorf("unknown provider: %d, want 404", code)
	}

	var audit struct{ Events []struct{ Event string } }
	e.get(owner, "/audit", &audit)
	var events []string
	for _, ev := range audit.Events {
		events = append(events, ev.Event)
	}
	if !slices.Contains(events, "create-provider") || !slices.Contains(events, "update-provider") {
		t.Errorf("audit: %v", events)
	}
}

func TestProviderWithBindingsCanOnlyBeDisabled(t *testing.T) {
	e := start(t)
	owner := e.token(e.owner, nil)
	for _, id := range []string{"google", "corp"} {
		body := google(nil)
		body["id"] = id
		if code := e.call("POST", owner, "/providers", body, nil); code != 204 {
			t.Fatalf("add %s: %d", id, code)
		}
	}
	// ALICE has a phone too, BOB only Google, CAROL Google and corp.
	e.user("ALICE", nil, "phone:+8613800001111")
	e.user("BOB", nil)
	e.user("CAROL", nil)
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO external_identities (provider, subject, user_id) VALUES
		('google', 'a', 'ALICE'), ('google', 'b', 'BOB'), ('google', 'c', 'CAROL'), ('corp', 'c', 'CAROL')`); err != nil {
		t.Fatal(err)
	}
	byID := func() map[string]providerInfo {
		m := map[string]providerInfo{}
		for _, p := range e.providers(owner).Providers {
			m[p.ID] = p
		}
		return m
	}
	if p := byID()["google"]; p.Bound != 3 || p.OnlyLoginPath != 1 {
		t.Errorf("google counts: %+v", p)
	}
	if p := byID()["corp"]; p.Bound != 1 || p.OnlyLoginPath != 0 {
		t.Errorf("corp counts: %+v", p)
	}

	if code := e.call("DELETE", owner, "/providers/google", nil, nil); code != 409 {
		t.Errorf("delete bound: %d, want 409", code)
	}
	if code := e.call("POST", owner, "/providers/google/disable", nil, nil); code != 204 {
		t.Fatalf("disable: %d", code)
	}
	if p := byID()["google"]; p.Enabled {
		t.Errorf("still enabled: %+v", p)
	}
	if code := e.call("POST", owner, "/providers/google/enable", nil, nil); code != 204 || !byID()["google"].Enabled {
		t.Errorf("enable: %d", code)
	}

	if _, err := e.pool.Exec(context.Background(), `DELETE FROM users WHERE id IN ('ALICE', 'BOB', 'CAROL')`); err != nil {
		t.Fatal(err)
	}
	if code := e.call("DELETE", owner, "/providers/google", nil, nil); code != 204 {
		t.Errorf("delete unbound: %d", code)
	}
	if _, ok := byID()["google"]; ok {
		t.Error("google still listed")
	}
	if code := e.call("DELETE", owner, "/providers/google", nil, nil); code != 404 {
		t.Errorf("delete again: %d, want 404", code)
	}

	var audit struct{ Events []struct{ Event string } }
	e.get(owner, "/audit", &audit)
	var events []string
	for _, ev := range audit.Events {
		events = append(events, ev.Event)
	}
	for _, want := range []string{"disable-provider", "delete-provider"} {
		if !slices.Contains(events, want) {
			t.Errorf("audit lacks %s: %v", want, events)
		}
	}
}
