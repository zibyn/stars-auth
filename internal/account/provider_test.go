package account_test

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"
	"time"

	"github.com/zibyn/stars-auth/internal/provider"
	_ "github.com/zibyn/stars-auth/internal/provider/oidc"
	"github.com/zibyn/stars-auth/internal/provider/providertest"
)

// addGoogle adds an in-process upstream as the Provider "google".
func (e *env) addGoogle() *providertest.Upstream {
	e.t.Helper()
	up := providertest.Start(e.t, provider.CallbackURL(e.issuer, "google"))
	if err := provider.NewStore(e.pool, e.keyring).Create(context.Background(), "google", "oidc", "Google",
		map[string]string{"issuer": up.Issuer, "client_id": "stars", "client_secret": "shh"}); err != nil {
		e.t.Fatal(err)
	}
	return up
}

// redirect asks the Account API to send the browser to a Provider, follows
// the browser there and back, and returns where it lands in the account
// center: its query says how it went.
func (e *env) redirect(tok, path string) url.Values {
	e.t.Helper()
	var out struct {
		URL string `json:"url"`
	}
	if c := e.call("POST", tok, path, nil, &out); c != 200 {
		e.t.Fatalf("POST %s: %d", path, c)
	}
	jar, _ := cookiejar.New(nil)
	var landed *url.URL
	browser := &http.Client{Jar: jar, CheckRedirect: func(r *http.Request, _ []*http.Request) error {
		if r.URL.Path == "/account" {
			landed = r.URL
			return http.ErrUseLastResponse
		}
		return nil
	}}
	resp, err := browser.Get(out.URL)
	if err != nil {
		e.t.Fatal(err)
	}
	_ = resp.Body.Close()
	if landed == nil {
		e.t.Fatalf("browser stopped at %s with %d", resp.Request.URL, resp.StatusCode)
	}
	return landed.Query()
}

type externalIdentities struct {
	ExternalIdentities []struct {
		Provider string    `json:"provider"`
		Name     string    `json:"name"`
		BoundAt  time.Time `json:"boundAt"`
	} `json:"externalIdentities"`
	Providers []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"providers"`
}

func (e *env) bound(tok string) externalIdentities {
	e.t.Helper()
	var got externalIdentities
	if c := e.call("GET", tok, "/v1/account/me", nil, &got); c != 200 {
		e.t.Fatalf("me: %d", c)
	}
	return got
}

// Binding goes to the Provider after a recent authentication and comes
// back with the External Identity bound.
func TestBindExternalIdentity(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	e.addGoogle()

	got := e.bound(e.signIn("ALICE", time.Hour))
	if len(got.ExternalIdentities) != 0 || len(got.Providers) != 1 || got.Providers[0].Name != "Google" {
		t.Fatalf("before: %+v", got)
	}
	if c := e.call("POST", e.signIn("ALICE", time.Hour), "/v1/account/providers/google/bind", nil, nil); c != 403 {
		t.Errorf("bind without reauthentication: %d", c)
	}
	tok := e.signIn("ALICE", 0)
	if q := e.redirect(tok, "/v1/account/providers/google/bind"); q.Get("bound") != "google" || q.Has("error") {
		t.Errorf("landed with %v", q)
	}
	got = e.bound(tok)
	if len(got.ExternalIdentities) != 1 || got.ExternalIdentities[0].Provider != "google" ||
		got.ExternalIdentities[0].Name != "Google" || time.Since(got.ExternalIdentities[0].BoundAt) > time.Minute {
		t.Errorf("after: %+v", got)
	}
	e.audited(t, "external_identity.bound", 1)
}

// An External Identity is one User's: binding another's is refused, and so
// is a second one of the same Provider (ADR 0003).
func TestBindRefusesAnotherUsersExternalIdentity(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	e.user("BOB", "phone:+8613900139000")
	up := e.addGoogle()
	bob := e.signIn("BOB", 0)
	if q := e.redirect(bob, "/v1/account/providers/google/bind"); q.Get("bound") != "google" {
		t.Fatalf("Bob binds: %v", q)
	}
	if q := e.redirect(bob, "/v1/account/providers/google/bind"); q.Get("bound") != "google" {
		t.Errorf("Bob binds the same again: %v", q)
	}

	alice := e.signIn("ALICE", 0)
	if q := e.redirect(alice, "/v1/account/providers/google/bind"); q.Get("error") != "这个外部账号已绑定其他账号,请先在那边解绑或注销" {
		t.Errorf("Alice binds Bob's: %v", q)
	}
	if got := e.bound(alice); len(got.ExternalIdentities) != 0 {
		t.Errorf("Alice: %+v", got)
	}
	up.Sub = "google-user-2"
	if q := e.redirect(bob, "/v1/account/providers/google/bind"); q.Get("error") != "已绑定这个服务商的另一个账号,请先解绑" {
		t.Errorf("Bob binds a second Google account: %v", q)
	}
}
