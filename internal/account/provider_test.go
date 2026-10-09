package account_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"
	"time"

	"github.com/zibyn/stars-auth/internal/channel"
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
	e.audited(t, "external_identity.added", 1)
}

// revoking is a Provider type that is told of unbindings, like Apple: it
// records the tokens, and fails while its config says so.
type revoking struct{ fail string }

var revoked = make(chan string, 10)

func (r revoking) AuthURL(context.Context, string, string, string, string) (string, error) {
	return "", errors.New("not here")
}

func (r revoking) Callback(context.Context, url.Values, string, string, string) (provider.Identity, error) {
	return provider.Identity{}, errors.New("not here")
}

func (r revoking) Unlink(_ context.Context, token string) error {
	if r.fail != "" {
		return errors.New(r.fail)
	}
	revoked <- token
	return nil
}

func init() {
	provider.Register(provider.Type{Key: "revoking", Name: "Revoking",
		Fields: []provider.ConfigField{{Field: channel.Field{Key: "fail", Label: "Fail", Type: "text", Optional: true}}},
		New:    func(c map[string]string) (provider.Redirect, error) { return revoking{c["fail"]}, nil }})
}

// Unbinding leaves the User a way to sign in, and tells a Provider that
// asks; its failing to revoke is audited and the unbinding stands.
func TestUnbindExternalIdentity(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	e.user("ALICE", "phone:+8613800138000")
	e.addGoogle()
	providers := provider.NewStore(e.pool, e.keyring)
	if err := providers.Create(ctx, "apple", "revoking", "Apple", map[string]string{}); err != nil {
		t.Fatal(err)
	}
	tok := e.signIn("ALICE", 0)
	e.redirect(tok, "/v1/account/providers/google/bind")
	sealed, err := e.keyring.Seal([]byte("refresh-1"), []byte("external_identity:apple:apple-1"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO external_identities (provider, subject, user_id, token)
		VALUES ('apple', 'apple-1', 'ALICE', $1)`, sealed); err != nil {
		t.Fatal(err)
	}

	if c := e.call("DELETE", e.signIn("ALICE", time.Hour), "/v1/account/providers/google", nil, nil); c != 403 {
		t.Errorf("unbind without reauthentication: %d", c)
	}
	if c := e.call("DELETE", tok, "/v1/account/identifiers/phone", nil, nil); c != 204 {
		t.Fatalf("unbind the phone: %d", c)
	}
	if c := e.call("DELETE", tok, "/v1/account/providers/google", nil, nil); c != 204 {
		t.Fatalf("unbind Google: %d", c)
	}
	e.audited(t, "external_identity.removed", 1)
	if c := e.call("DELETE", tok, "/v1/account/providers/google", nil, nil); c != 422 {
		t.Errorf("unbind Google again: %d", c)
	}

	// Apple is the last way to sign in.
	if c := e.call("DELETE", tok, "/v1/account/providers/apple", nil, nil); c != 422 {
		t.Errorf("unbind the last: %d", c)
	}
	if got := e.bound(tok); len(got.ExternalIdentities) != 1 || got.ExternalIdentities[0].Name != "Apple" {
		t.Errorf("left: %+v", got)
	}
	if len(revoked) != 0 {
		t.Errorf("revoked %q", <-revoked)
	}

	e.user("BOB", "phone:+8613900139000")
	if _, err := e.pool.Exec(ctx, `UPDATE external_identities SET user_id = 'BOB'`); err != nil {
		t.Fatal(err)
	}
	if c := e.call("DELETE", e.signIn("BOB", 0), "/v1/account/providers/apple", nil, nil); c != 204 || len(revoked) != 1 || <-revoked != "refresh-1" {
		t.Errorf("unbind Apple: %d", c)
	}

	// Disabled and failing to revoke.
	if _, err := e.pool.Exec(ctx, `INSERT INTO external_identities (provider, subject, user_id) VALUES ('apple', 'apple-2', 'BOB')`); err != nil {
		t.Fatal(err)
	}
	if err := providers.Update(ctx, "apple", "Apple", map[string]string{"fail": "apple is down"}); err != nil {
		t.Fatal(err)
	}
	if err := providers.SetEnabled(ctx, "apple", false); err != nil {
		t.Fatal(err)
	}
	if c := e.call("DELETE", e.signIn("BOB", 0), "/v1/account/providers/apple", nil, nil); c != 204 {
		t.Errorf("unbind Apple failing to revoke: %d", c)
	}
	var detail string
	if err := e.pool.QueryRow(ctx, `SELECT detail->>'error' FROM audit_log WHERE event = 'provider.unlink_failed' AND sub = 'BOB'`).Scan(&detail); err != nil || detail != "apple is down" {
		t.Errorf("revoke failure audited: %q %v", detail, err)
	}
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
