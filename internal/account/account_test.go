package account_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/account"
	"github.com/zibyn/stars-auth/internal/channel"
	_ "github.com/zibyn/stars-auth/internal/channel/webhook"
	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db"
	"github.com/zibyn/stars-auth/internal/db/dbtest"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/login"
	"github.com/zibyn/stars-auth/internal/oidcstore"
	"github.com/zibyn/stars-auth/internal/server"
	"github.com/zibyn/stars-auth/internal/webhook"
)

type env struct {
	t       *testing.T
	pool    *pgxpool.Pool
	keyring *crypt.Keyring
	issuer  string
	keys    *oidcstore.Keys
	inbox   *inbox
}

func start(t *testing.T) *env {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.Fresh(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	keyring, err := crypt.NewKeyring(1, map[byte][]byte{1: bytes.Repeat([]byte{7}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	keys := oidcstore.NewKeys(pool, keyring)
	if err := keys.Ensure(ctx); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(nil)
	t.Cleanup(ts.Close)
	ts.Config.Handler = server.New(pool.Ping, http.NotFoundHandler(), nil, account.New(pool, keyring, ts.URL).Register)
	e := &env{t: t, pool: pool, keyring: keyring, issuer: ts.URL, keys: keys, inbox: &inbox{codes: map[string]string{}}}
	hook := httptest.NewServer(e.inbox)
	t.Cleanup(hook.Close)
	for _, kind := range []string{"phone", "email"} {
		if err := channel.NewStore(pool, keyring).Put(ctx, kind, "webhook", map[string]string{"url": hook.URL, "secret": "s"}); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

// inbox is the Webhook Channel's receiver: the last code sent to each
// Identifier.
type inbox struct {
	mu    sync.Mutex
	codes map[string]string
}

func (in *inbox) ServeHTTP(_ http.ResponseWriter, r *http.Request) {
	var m struct{ To, Code string }
	_ = json.NewDecoder(r.Body).Decode(&m)
	in.mu.Lock()
	defer in.mu.Unlock()
	in.codes[m.To] = m.Code
}

func (in *inbox) take(to string) string {
	in.mu.Lock()
	defer in.mu.Unlock()
	code := in.codes[to]
	delete(in.codes, to)
	return code
}

// user adds a User with the given Identifiers ("kind:value").
func (e *env) user(sub string, idents ...string) {
	e.t.Helper()
	ctx := context.Background()
	q := sqlc.New(e.pool)
	if err := q.CreateUser(ctx, sub); err != nil {
		e.t.Fatal(err)
	}
	for _, id := range idents {
		kind, value, _ := strings.Cut(id, ":")
		if err := q.AddIdentifier(ctx, sqlc.AddIdentifierParams{UserID: sub, Kind: kind, Value: value}); err != nil {
			e.t.Fatal(err)
		}
	}
}

// signIn starts a browser Session for sub, authenticated ago, and returns
// an account center access token issued in it.
func (e *env) signIn(sub string, ago time.Duration) string {
	e.t.Helper()
	var sid string
	if err := e.pool.QueryRow(context.Background(), `
		INSERT INTO sessions (id_hash, client_id, user_id, auth_time, amr)
		VALUES (sha256(random()::text::bytea), 'stars-auth-account', $1, now() - $2 * interval '1 second', '{sms}') RETURNING id`,
		sub, ago.Seconds()).Scan(&sid); err != nil {
		e.t.Fatal(err)
	}
	return e.token(sub, map[string]any{"sid": sid})
}

// token signs an access token the way the OIDC provider does; extra adds
// or overrides claims.
func (e *env) token(sub string, extra map[string]any) string {
	e.t.Helper()
	jwks, err := e.keys.JWKS(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	claims := map[string]any{
		"iss": e.issuer, "sub": sub, "aud": identity.AccountAPI, "client_id": login.AccountClientID,
		"iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix(),
	}
	for k, v := range extra {
		claims[k] = v
	}
	k := jwks.Keys[0]
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: k.Key, KeyID: k.KeyID}},
		(&jose.SignerOptions{}).WithType("at+jwt"))
	if err != nil {
		e.t.Fatal(err)
	}
	signed, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		e.t.Fatal(err)
	}
	return signed
}

// call sends body as JSON (nil for none) with a bearer token and decodes a
// 2xx body into out; it returns the status.
func (e *env) call(method, token, path string, body, out any) int {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		js, _ := json.Marshal(body)
		rd = bytes.NewReader(js)
	}
	req, _ := http.NewRequest(method, e.issuer+path, rd)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && resp.StatusCode < 300 && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v %s", method, path, err, raw)
		}
	}
	return resp.StatusCode
}

type me struct {
	RecentAuthUntil time.Time `json:"recentAuthUntil"`
	Sub             string    `json:"sub"`
	Identifiers     []struct {
		Kind  string `json:"kind"`
		Value string `json:"value"`
	} `json:"identifiers"`
	HasPassword bool `json:"hasPassword"`
}

// The Account API takes the account center's access tokens, while the
// Session they were issued in lives.
func TestAccountAPINeedsALiveSession(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	tok := e.signIn("ALICE", 0)

	var got me
	if code := e.call("GET", tok, "/v1/account/me", nil, &got); code != 200 ||
		got.Sub != "ALICE" || len(got.Identifiers) != 1 || got.Identifiers[0].Value != "+8613800138000" {
		t.Fatalf("me: %d %+v", code, got)
	}
	if code := e.call("GET", e.token("ALICE", map[string]any{"aud": identity.ManagementAPI}), "/v1/account/me", nil, nil); code != 401 {
		t.Errorf("another API's token: %d", code)
	}
	if code := e.call("GET", e.token("ALICE", nil), "/v1/account/me", nil, nil); code != 401 {
		t.Errorf("token without a Session: %d", code)
	}
	if _, err := e.pool.Exec(context.Background(), "UPDATE sessions SET ended_at = now()"); err != nil {
		t.Fatal(err)
	}
	if code := e.call("GET", tok, "/v1/account/me", nil, nil); code != 401 {
		t.Errorf("ended Session: %d", code)
	}
}

// Sensitive actions need an authentication in the last 10 minutes; a code
// to one of the User's own Identifiers, or their password, makes one.
func TestReauthentication(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000", "email:alice@example.com")
	tok := e.signIn("ALICE", 20*time.Minute)

	if code := e.call("DELETE", tok, "/v1/account/identifiers/email", nil, nil); code != 403 {
		t.Fatalf("unbind without reauthentication: %d", code)
	}
	if code := e.call("POST", tok, "/v1/account/reauth/code", map[string]string{"kind": "phone"}, nil); code != 204 {
		t.Fatalf("send reauth code: %d", code)
	}
	code := e.inbox.take("+8613800138000")
	if c := e.call("POST", tok, "/v1/account/reauth", map[string]string{"kind": "phone", "code": "000000x"}, nil); c != 422 {
		t.Errorf("wrong code: %d", c)
	}
	if c := e.call("POST", tok, "/v1/account/reauth", map[string]string{"kind": "phone", "code": code}, nil); c != 204 {
		t.Fatalf("reauth: %d", c)
	}
	var got me
	if c := e.call("GET", tok, "/v1/account/me", nil, &got); c != 200 || time.Until(got.RecentAuthUntil) < 9*time.Minute {
		t.Errorf("after reauth: %d %+v", c, got)
	}
	if c := e.call("DELETE", tok, "/v1/account/identifiers/email", nil, nil); c != 204 {
		t.Errorf("unbind after reauthentication: %d", c)
	}

	// A password works too, when the setting lets this User use one.
	e.password("ALICE", "password1")
	if _, err := e.pool.Exec(context.Background(), "UPDATE settings SET password_login = 'all'; UPDATE sessions SET auth_time = now() - interval '1 hour'"); err != nil {
		t.Fatal(err)
	}
	if c := e.call("POST", tok, "/v1/account/reauth", map[string]string{"password": "wrong-one"}, nil); c != 422 {
		t.Errorf("wrong password: %d", c)
	}
	if c := e.call("POST", tok, "/v1/account/reauth", map[string]string{"password": "password1"}, nil); c != 204 {
		t.Errorf("reauth by password: %d", c)
	}
}

// password sets sub's password.
func (e *env) password(sub, password string) {
	e.t.Helper()
	if err := identity.New(e.pool, e.keyring).SetPassword(context.Background(), sub, password); err != nil {
		e.t.Fatal(err)
	}
}

// A new phone number or email is verified with a code; the old one is not
// asked for. One another User holds cannot be bound.
func TestChangeIdentifier(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	e.user("BOB", "email:bob@example.com")
	tok := e.signIn("ALICE", 0)

	if c := e.call("POST", tok, "/v1/account/identifiers/phone/code", map[string]string{"value": "13900139000"}, nil); c != 204 {
		t.Fatalf("send code to the new phone: %d", c)
	}
	code := e.inbox.take("+8613900139000")
	if c := e.call("PUT", tok, "/v1/account/identifiers/phone", map[string]string{"value": "13900139000", "code": "nope"}, nil); c != 422 {
		t.Errorf("wrong code: %d", c)
	}
	if c := e.call("PUT", tok, "/v1/account/identifiers/phone", map[string]string{"value": "13900139000", "code": code}, nil); c != 204 {
		t.Fatalf("change phone: %d", c)
	}
	// Binding an email the User has none of works the same way.
	if c := e.call("POST", tok, "/v1/account/identifiers/email/code", map[string]string{"value": "Alice@Example.com"}, nil); c != 204 {
		t.Fatalf("send code to the new email: %d", c)
	}
	if c := e.call("PUT", tok, "/v1/account/identifiers/email", map[string]string{"value": "alice@example.com", "code": e.inbox.take("alice@example.com")}, nil); c != 204 {
		t.Fatalf("bind email: %d", c)
	}
	var got me
	e.call("GET", tok, "/v1/account/me", nil, &got)
	if len(got.Identifiers) != 2 || got.Identifiers[0].Value != "alice@example.com" || got.Identifiers[1].Value != "+8613900139000" {
		t.Errorf("identifiers: %+v", got.Identifiers)
	}

	if c := e.call("POST", tok, "/v1/account/identifiers/email/code", map[string]string{"value": "13900139000"}, nil); c != 422 {
		t.Errorf("a phone number as the email: %d", c)
	}
	if c := e.call("POST", tok, "/v1/account/identifiers/email/code", map[string]string{"value": "bob@example.com"}, nil); c != 409 {
		t.Errorf("another User's email: %d", c)
	}
}

// The last way to sign in cannot be removed: a phone number, an email, or a
// username with a password.
func TestLastLoginPathStays(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000", "username:alice")
	tok := e.signIn("ALICE", 0)

	if c := e.call("DELETE", tok, "/v1/account/identifiers/phone", nil, nil); c != 422 {
		t.Errorf("unbind the only phone, username without password: %d", c)
	}
	if _, err := e.pool.Exec(context.Background(), "UPDATE settings SET password_login = 'all'"); err != nil {
		t.Fatal(err)
	}
	if c := e.call("PUT", tok, "/v1/account/password", map[string]string{"password": "short"}, nil); c != 422 {
		t.Errorf("too short a password: %d", c)
	}
	if c := e.call("PUT", tok, "/v1/account/password", map[string]string{"password": "password1"}, nil); c != 204 {
		t.Fatalf("set password: %d", c)
	}
	if c := e.call("DELETE", tok, "/v1/account/identifiers/phone", nil, nil); c != 204 {
		t.Fatalf("unbind phone, username and password stay: %d", c)
	}
	if c := e.call("DELETE", tok, "/v1/account/password", nil, nil); c != 422 {
		t.Errorf("remove the password of the last login path: %d", c)
	}
	var n int
	if err := e.pool.QueryRow(context.Background(),
		"SELECT count(*) FROM audit_log WHERE sub = 'ALICE' AND event IN ('password.changed', 'identifier.removed') AND detail->>'by' = 'ALICE'").Scan(&n); err != nil || n != 2 {
		t.Errorf("audited %d events: %v", n, err)
	}

	// With password login off, no password can be set.
	if _, err := e.pool.Exec(context.Background(), "UPDATE settings SET password_login = 'off'"); err != nil {
		t.Fatal(err)
	}
	if c := e.call("PUT", tok, "/v1/account/password", map[string]string{"password": "password2"}, nil); c != 422 {
		t.Errorf("set password while password login is off: %d", c)
	}
}

// A User sees their Sessions, ended ones too, and can sign any of them out.
func TestOwnSessions(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	e.user("BOB", "phone:+8613900139000")
	tok := e.signIn("ALICE", 0)
	other := e.signIn("ALICE", time.Hour)
	e.signIn("BOB", 0)

	type session struct {
		ID          string `json:"id"`
		Application string `json:"application"`
		Current     bool   `json:"current"`
		Active      bool   `json:"active"`
	}
	var list struct{ Sessions []session }
	if c := e.call("GET", tok, "/v1/account/sessions", nil, &list); c != 200 || len(list.Sessions) != 2 {
		t.Fatalf("list: %d %+v", c, list)
	}
	var current, rest session
	for _, s := range list.Sessions {
		if s.Current {
			current = s
		} else {
			rest = s
		}
	}
	if current.ID == "" || rest.ID == "" || current.Application != "Stars Auth 账号中心" {
		t.Fatalf("sessions: %+v", list.Sessions)
	}
	var bob string
	if err := e.pool.QueryRow(context.Background(), "SELECT id FROM sessions WHERE user_id = 'BOB'").Scan(&bob); err != nil {
		t.Fatal(err)
	}
	if c := e.call("DELETE", tok, "/v1/account/sessions/"+bob, nil, nil); c != 404 {
		t.Errorf("end another User's Session: %d", c)
	}
	if c := e.call("DELETE", tok, "/v1/account/sessions/"+rest.ID, nil, nil); c != 204 {
		t.Fatalf("end Session: %d", c)
	}
	if c := e.call("GET", other, "/v1/account/me", nil, nil); c != 401 {
		t.Errorf("the ended Session's token: %d", c)
	}
	e.call("GET", tok, "/v1/account/sessions", nil, &list)
	if len(list.Sessions) != 2 {
		t.Errorf("ended Session left the list: %+v", list.Sessions)
	}
	for _, s := range list.Sessions {
		if s.ID == rest.ID && s.Active {
			t.Errorf("ended Session still active: %+v", s)
		}
	}
}

// Exporting gives the User's data as JSON, after reauthenticating.
func TestExport(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO consents (user_id, version, client_id) VALUES ('ALICE', 'v1', 'rp');
		INSERT INTO audit_log (event, sub, detail) VALUES ('identifier.replaced', 'ALICE', '{"kind": "phone", "by": "ADMIN"}');
		INSERT INTO audit_log (event, sub, detail) VALUES ('user.disabled', 'BOB', '{"by": "ADMIN"}')`); err != nil {
		t.Fatal(err)
	}
	if c := e.call("GET", e.signIn("ALICE", time.Hour), "/v1/account/export", nil, nil); c != 403 {
		t.Errorf("export without reauthentication: %d", c)
	}
	var got struct {
		Sub         string           `json:"sub"`
		Identifiers []map[string]any `json:"identifiers"`
		Credentials struct {
			Password bool `json:"password"`
		} `json:"credentials"`
		Sessions []map[string]any `json:"sessions"`
		Consents []struct {
			Version string `json:"version"`
		} `json:"consents"`
		AuditEvents []struct {
			Event string `json:"event"`
		} `json:"auditEvents"`
	}
	if c := e.call("GET", e.signIn("ALICE", 0), "/v1/account/export", nil, &got); c != 200 {
		t.Fatalf("export: %d", c)
	}
	if got.Sub != "ALICE" || len(got.Identifiers) != 1 || got.Credentials.Password || len(got.Sessions) != 2 ||
		len(got.Consents) != 1 || got.Consents[0].Version != "v1" || len(got.AuditEvents) != 1 || got.AuditEvents[0].Event != "identifier.replaced" {
		t.Errorf("export: %+v", got)
	}
}

// receiver is an Application's webhook endpoint, checking signatures the
// Standard Webhooks way.
type receiver struct {
	t      *testing.T
	secret string
	mu     sync.Mutex
	events []map[string]any
	fail   int // answer 500 this many times first
}

func (rc *receiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	id, ts := r.Header.Get("webhook-id"), r.Header.Get("webhook-timestamp")
	mac := hmac.New(sha256.New, []byte(rc.secret))
	mac.Write([]byte(id + "." + ts + "." + string(body)))
	want := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if id == "" || r.Header.Get("webhook-signature") != want {
		rc.t.Errorf("bad signature: id %q ts %q sig %q", id, ts, r.Header.Get("webhook-signature"))
	}
	rc.mu.Lock()
	defer rc.mu.Unlock()
	if rc.fail > 0 {
		rc.fail--
		w.WriteHeader(500)
		return
	}
	var ev map[string]any
	_ = json.Unmarshal(body, &ev)
	rc.events = append(rc.events, ev)
}

// webhookApp registers an Application whose webhook goes to rc.
func (e *env) webhookApp(clientID string, rc *receiver) {
	e.t.Helper()
	ctx := context.Background()
	if err := oidcstore.CreateApplication(ctx, e.pool, oidcstore.Application{ClientID: clientID, Name: clientID}); err != nil {
		e.t.Fatal(err)
	}
	sealed, err := e.keyring.Seal([]byte(rc.secret), []byte("application:"+clientID+":webhook"))
	if err != nil {
		e.t.Fatal(err)
	}
	srv := httptest.NewServer(rc)
	e.t.Cleanup(srv.Close)
	if _, err := e.pool.Exec(ctx, "UPDATE applications SET webhook_url = $2, webhook_secret = $3 WHERE client_id = $1", clientID, srv.URL, sealed); err != nil {
		e.t.Fatal(err)
	}
}

// Deleting an account takes effect at once: the sub is gone for good, the
// phone number is free for a new User, and every Application with a webhook
// hears of it.
func TestDeleteAccount(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	const phone = "+8613800138000"
	ids := identity.New(e.pool, e.keyring)
	sub, err := ids.SignIn(ctx, "phone", phone)
	if err != nil {
		t.Fatal(err)
	}
	rc := &receiver{t: t, secret: "s3cret", fail: 1}
	e.webhookApp("rp", rc)
	tok := e.signIn(sub, 0)
	other := e.signIn(sub, 0)

	if c := e.call("DELETE", e.signIn(sub, time.Hour), "/v1/account/me", nil, nil); c != 403 {
		t.Errorf("delete without reauthentication: %d", c)
	}
	if c := e.call("DELETE", tok, "/v1/account/me", nil, nil); c != 204 {
		t.Fatalf("delete: %d", c)
	}
	if c := e.call("GET", other, "/v1/account/me", nil, nil); c != 401 {
		t.Errorf("another Session of the deleted User: %d", c)
	}
	again, err := ids.SignIn(ctx, "phone", phone)
	if err != nil || again == sub {
		t.Errorf("same phone signs in again as %q (was %q): %v", again, sub, err)
	}

	hooks := webhook.New(e.pool, e.keyring)
	if err := hooks.Deliver(ctx); err != nil {
		t.Fatal(err)
	}
	if len(rc.events) != 0 {
		t.Fatalf("delivered despite a 500: %v", rc.events)
	}
	// The failed delivery is retried later.
	if _, err := e.pool.Exec(ctx, "UPDATE webhook_deliveries SET next_at = now()"); err != nil {
		t.Fatal(err)
	}
	if err := hooks.Deliver(ctx); err != nil {
		t.Fatal(err)
	}
	if len(rc.events) != 1 || rc.events[0]["type"] != "user.deleted" || rc.events[0]["data"].(map[string]any)["sub"] != sub {
		t.Errorf("events: %v", rc.events)
	}
	var left int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM webhook_deliveries").Scan(&left); err != nil || left != 0 {
		t.Errorf("%d deliveries left: %v", left, err)
	}
}

// The last owner cannot delete their account.
func TestLastOwnerCannotDeleteThemselves(t *testing.T) {
	e := start(t)
	e.user("OWNER", "username:owner")
	if _, err := e.pool.Exec(context.Background(), "INSERT INTO user_roles VALUES ('OWNER', $1, 'owner')", identity.ManagementAPI); err != nil {
		t.Fatal(err)
	}
	if c := e.call("DELETE", e.signIn("OWNER", 0), "/v1/account/me", nil, nil); c != 409 {
		t.Errorf("last owner deletes themselves: %d", c)
	}
}

// Apps delete the account through the direct auth API with their own access
// token, after a fresh sign-in; otherwise they are told to step up
// (RFC 9470).
func TestDirectAPIDeletesTheAccount(t *testing.T) {
	e := start(t)
	e.user("ALICE", "phone:+8613800138000")
	del := func(token string) *http.Response {
		req, _ := http.NewRequest("POST", e.issuer+"/v1/auth/delete", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	appToken := func(ago time.Duration) string {
		tok := e.signIn("ALICE", ago)
		claims, _ := jwt.ParseSigned(tok, []jose.SignatureAlgorithm{jose.RS256})
		var c map[string]any
		_ = claims.UnsafeClaimsWithoutVerification(&c)
		return e.token("ALICE", map[string]any{"sid": c["sid"], "aud": "https://track.example", "client_id": "app"})
	}

	if resp := del("garbage"); resp.StatusCode != 401 {
		t.Errorf("bad token: %d", resp.StatusCode)
	}
	resp := del(appToken(time.Hour))
	if www := resp.Header.Get("WWW-Authenticate"); resp.StatusCode != 401 ||
		!strings.Contains(www, `error="insufficient_user_authentication"`) || !strings.Contains(www, `max_age="600"`) {
		t.Errorf("stale sign-in: %d %q", resp.StatusCode, www)
	}
	if resp := del(appToken(0)); resp.StatusCode != 204 {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	var n int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM users").Scan(&n); err != nil || n != 0 {
		t.Errorf("%d users left: %v", n, err)
	}
}
