package login_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/channel"
	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db"
	"github.com/zibyn/stars-auth/internal/db/dbtest"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/login"
	"github.com/zibyn/stars-auth/internal/oidcstore"
	"github.com/zibyn/stars-auth/internal/server"
)

const (
	clientID    = "rp"
	callback    = "https://rp.example/cb"
	afterLogout = "https://rp.example/bye"
	verifier    = "a-pkce-code-verifier-that-is-at-least-43-characters-long"
)

type env struct {
	t      *testing.T
	issuer string
	client *http.Client // a browser: keeps cookies, stops at redirects
	ids    *identity.Store
	pool   *pgxpool.Pool
	inbox  *inbox
}

// start runs the whole HTTP surface against a fresh database, with one public
// Application registered.
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
	if err := oidcstore.NewKeys(pool, keyring).Ensure(ctx); err != nil {
		t.Fatal(err)
	}
	if err := oidcstore.CreateApplication(ctx, pool, oidcstore.Application{
		ClientID: clientID, Name: "Test RP", RedirectURIs: []string{callback}, PostLogoutRedirectURIs: []string{afterLogout},
	}); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewUnstartedServer(nil)
	ts.StartTLS()
	t.Cleanup(ts.Close)
	auth, err := login.New(ctx, pool, keyring, ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = server.New(pool.Ping, http.NotFoundHandler(), nil, auth.Register)
	e := &env{t: t, issuer: ts.URL, client: ts.Client(), ids: identity.New(pool, keyring), pool: pool, inbox: &inbox{codes: map[string]string{}}}
	e.newBrowser()
	hook := httptest.NewServer(e.inbox)
	t.Cleanup(hook.Close)
	for _, kind := range []string{"phone", "email"} {
		if err := channel.NewStore(pool, keyring).Put(ctx, kind, "webhook", map[string]string{"url": hook.URL, "secret": "s"}); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func (e *env) newBrowser() {
	jar, _ := cookiejar.New(nil)
	c := *e.client
	c.Jar = jar
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	e.client = &c
}

func (e *env) do(method, path string, form url.Values) (*http.Response, string) {
	e.t.Helper()
	u := path
	if !strings.HasPrefix(u, "https://") {
		u = e.issuer + path
	}
	req, err := http.NewRequest(method, u, strings.NewReader(form.Encode()))
	if err != nil {
		e.t.Fatal(err)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

// authorize starts a code flow with extra parameters.
func (e *env) authorize(extra string) (*http.Response, string) {
	return e.authorizeAs(clientID, callback, extra)
}

func (e *env) authorizeAs(client, redirect, extra string) (*http.Response, string) {
	sum := sha256.Sum256([]byte(verifier))
	over, _ := url.ParseQuery(extra)
	q := url.Values{
		"client_id":             {client},
		"response_type":         {"code"},
		"scope":                 {"openid"},
		"redirect_uri":          {redirect},
		"state":                 {"st"},
		"nonce":                 {"n"},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	for k, v := range over {
		q[k] = v
	}
	return e.do("GET", "/authorize?"+q.Encode(), nil)
}

var actionRE = regexp.MustCompile(`<form[^>]*action="([^"]+)"`)

// submit posts the password form found in page.
func (e *env) submit(page, username, password string) (*http.Response, string) {
	e.t.Helper()
	return e.post(page, url.Values{"op": {"password"}, "username": {username}, "password": {password}})
}

// post posts form to the login page's form action.
func (e *env) post(page string, form url.Values) (*http.Response, string) {
	e.t.Helper()
	m := actionRE.FindStringSubmatch(page)
	if m == nil {
		e.t.Fatalf("no login form in:\n%s", page)
	}
	return e.do("POST", html.UnescapeString(m[1]), form)
}

// code returns the authorization code a response redirects back with.
func (e *env) code(resp *http.Response) string {
	e.t.Helper()
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if resp.StatusCode/100 != 3 || loc.Query().Get("code") == "" {
		e.t.Fatalf("want a redirect with a code, got %d %q", resp.StatusCode, loc)
	}
	return loc.Query().Get("code")
}

func (e *env) idToken(code string) map[string]any {
	e.t.Helper()
	return e.claims(e.exchange(clientID, callback, code).IDToken)
}

type tokens struct {
	IDToken      string `json:"id_token"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func (e *env) exchange(client, redirect, code string) tokens {
	e.t.Helper()
	resp, body := e.do("POST", "/token", url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect},
		"client_id": {client}, "code_verifier": {verifier},
	})
	if resp.StatusCode != 200 {
		e.t.Fatalf("token: %d %s", resp.StatusCode, body)
	}
	var tok tokens
	if err := json.Unmarshal([]byte(body), &tok); err != nil {
		e.t.Fatal(err)
	}
	return tok
}

// claims verifies a JWT against the published JWKS.
func (e *env) claims(token string) map[string]any {
	e.t.Helper()
	_, jwksBody := e.do("GET", "/jwks", nil)
	var jwks jose.JSONWebKeySet
	if err := json.Unmarshal([]byte(jwksBody), &jwks); err != nil {
		e.t.Fatal(err)
	}
	parsed, err := jwt.ParseSigned(token, []jose.SignatureAlgorithm{jose.RS256})
	if err != nil {
		e.t.Fatal(err)
	}
	var claims map[string]any
	if err := parsed.Claims(jwks.Key(parsed.Headers[0].KeyID)[0].Key, &claims); err != nil {
		e.t.Fatal(err)
	}
	return claims
}

// bootstrap creates the owner through the setup page.
func (e *env) bootstrap(username, password string) {
	e.t.Helper()
	token, err := e.ids.SetupToken(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	resp, page := e.do("GET", "/setup?token="+token, nil)
	if resp.StatusCode != 200 || !strings.Contains(page, `value="`+token+`"`) {
		e.t.Fatalf("setup page: %d %s", resp.StatusCode, page)
	}
	if !strings.Contains(page, `autocomplete="new-password"`) {
		e.t.Errorf("setup page lacks autocomplete hints")
	}
	resp, page = e.do("POST", "/setup", url.Values{"token": {token}, "username": {username}, "password": {password}})
	if resp.StatusCode != 200 || strings.Contains(page, "<form") {
		e.t.Fatalf("setup: %d %s", resp.StatusCode, page)
	}
}

func TestSetupThenPasswordLogin(t *testing.T) {
	e := start(t)
	token, _ := e.ids.SetupToken(context.Background())

	// A wrong token is turned away and the form shown again.
	resp, page := e.do("POST", "/setup", url.Values{"token": {"nope"}, "username": {"owner"}, "password": {"password1"}})
	if !strings.Contains(page, identity.ErrSetupToken.Error()) || !strings.Contains(page, "<form") {
		t.Fatalf("wrong token: %d %s", resp.StatusCode, page)
	}

	e.bootstrap("owner", "password1")

	// The setup page is closed for good, and the token is dead.
	if resp, _ := e.do("GET", "/setup?token="+token, nil); resp.StatusCode != 404 {
		t.Errorf("setup page after bootstrap: %d", resp.StatusCode)
	}
	if resp, _ := e.do("POST", "/setup", url.Values{"token": {token}, "username": {"x"}, "password": {"password1"}}); resp.StatusCode != 404 {
		t.Errorf("setup again: %d", resp.StatusCode)
	}

	resp, page = e.authorize("")
	if resp.StatusCode != 200 {
		t.Fatalf("authorize: %d %s", resp.StatusCode, page)
	}
	for _, want := range []string{`autocomplete="username"`, `autocomplete="current-password"`, `method="post"`} {
		if !strings.Contains(page, want) {
			t.Errorf("login page lacks %s", want)
		}
	}

	resp, page = e.submit(page, "owner", "wrong-password")
	if resp.StatusCode != 200 || !strings.Contains(page, identity.ErrBadCredentials.Error()) {
		t.Fatalf("wrong password: %d %s", resp.StatusCode, page)
	}
	resp, _ = e.submit(page, "owner", "password1")
	claims := e.idToken(e.code(resp))
	sub, _ := claims["sub"].(string)
	if sub == "" || !slices.Equal(claims["amr"].([]any), []any{"pwd"}) || claims["auth_time"] == nil || claims["nonce"] != "n" {
		t.Errorf("id token claims: %v", claims)
	}

	// The browser Session signs the next request in silently.
	resp, _ = e.authorize("")
	if again := e.idToken(e.code(resp)); again["sub"] != sub || again["auth_time"] != claims["auth_time"] {
		t.Errorf("silent SSO: %v", again)
	}
	resp, _ = e.authorize("&prompt=none")
	e.code(resp)

	// These ask for the password again, even with a Session.
	for _, extra := range []string{"&prompt=login", "&prompt=select_account", "&max_age=0"} {
		if resp, page := e.authorize(extra); resp.StatusCode != 200 || !actionRE.MatchString(page) {
			t.Errorf("%s: want the login form, got %d", extra, resp.StatusCode)
		}
	}
	resp, _ = e.authorize("&prompt=none+login")
	if loc, _ := url.Parse(resp.Header.Get("Location")); loc.Query().Get("error") != "invalid_request" {
		t.Errorf("prompt=none login: %d %q", resp.StatusCode, loc)
	}
	// prompt=consent is accepted and ignored: no consent page.
	resp, _ = e.authorize("&prompt=consent")
	e.code(resp)

	// Without a Session, prompt=none fails back to the Application.
	e.newBrowser()
	resp, _ = e.authorize("&prompt=none")
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if !strings.HasPrefix(loc.String(), callback) || loc.Query().Get("error") != "login_required" {
		t.Errorf("prompt=none without a Session: %d %q", resp.StatusCode, loc)
	}
}

// A login form posted from another site is refused (login CSRF).
func TestLoginFormRejectsCrossSitePost(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	_, page := e.authorize("")
	m := actionRE.FindStringSubmatch(page)
	req, _ := http.NewRequest("POST", e.issuer+html.UnescapeString(m[1]),
		strings.NewReader(url.Values{"username": {"owner"}, "password": {"password1"}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode/100 == 3 && strings.Contains(resp.Header.Get("Location"), "code=") {
		t.Errorf("cross-site login went through")
	}
}

// The console signs in like any Application, and its access token is for the
// Management API.
func TestConsoleAccessTokenIsForManagementAPI(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	redirect := e.issuer + "/console/callback"
	_, page := e.authorizeAs(login.ConsoleClientID, redirect, "")
	resp, _ := e.submit(page, "owner", "password1")
	claims := e.claims(e.exchange(login.ConsoleClientID, redirect, e.code(resp)).AccessToken)
	if claims["aud"] != identity.ManagementAPI || claims["client_id"] != login.ConsoleClientID {
		t.Errorf("access token claims: %v", claims)
	}
}

// The account center signs in like any Application; its access token is for
// the Account API and names the Session it was issued in.
func TestAccountAccessTokenNamesItsSession(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	redirect := e.issuer + "/account/callback"
	_, page := e.authorizeAs(login.AccountClientID, redirect, "")
	resp, _ := e.submit(page, "owner", "password1")
	claims := e.claims(e.exchange(login.AccountClientID, redirect, e.code(resp)).AccessToken)
	var sid string
	if err := e.pool.QueryRow(context.Background(), "SELECT id FROM sessions").Scan(&sid); err != nil {
		t.Fatal(err)
	}
	if claims["aud"] != identity.AccountAPI || claims["sid"] != sid {
		t.Errorf("access token claims: %v, Session %s", claims, sid)
	}
}

// The access token carries the User's Roles and their Permissions on the
// API it is for, and only that API's; the ID token carries none.
func TestAccessTokenCarriesRolesOfItsAPI(t *testing.T) {
	e := start(t)
	e.bootstrap("owner", "password1")
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO apis (identifier, name) VALUES ('https://track.example', 'Track'), ('https://other.example', 'Other');
		INSERT INTO permissions (api, key, name) VALUES
			('https://track.example', 'track:read', 'r'), ('https://track.example', 'track:write', 'w'),
			('https://other.example', 'other:x', 'x');
		INSERT INTO roles (api, key, name) VALUES
			('https://track.example', 'viewer', 'V'), ('https://track.example', 'editor', 'E'), ('https://other.example', 'boss', 'B');
		INSERT INTO role_permissions VALUES
			('https://track.example', 'viewer', 'track:read'), ('https://track.example', 'editor', 'track:read'),
			('https://track.example', 'editor', 'track:write'), ('https://other.example', 'boss', 'other:x');
		INSERT INTO user_roles SELECT user_id, r.api, r.key FROM identifiers, roles r WHERE value = 'owner' AND NOT r.builtin;
		UPDATE applications SET default_api = 'https://track.example' WHERE client_id = 'rp'`); err != nil {
		t.Fatal(err)
	}
	_, page := e.authorize("")
	resp, _ := e.submit(page, "owner", "password1")
	tok := e.exchange(clientID, callback, e.code(resp))
	at := e.claims(tok.AccessToken)
	if at["aud"] != "https://track.example" ||
		fmt.Sprint(at["roles"]) != "[editor viewer]" || fmt.Sprint(at["entitlements"]) != "[track:read track:write]" {
		t.Errorf("access token: %v", at)
	}
	if id := e.claims(tok.IDToken); id["roles"] != nil || id["entitlements"] != nil || id["groups"] != nil {
		t.Errorf("ID token: %v", id)
	}
}
