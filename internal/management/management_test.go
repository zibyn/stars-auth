package management_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db"
	"github.com/zibyn/stars-auth/internal/db/dbtest"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/identity"
	"github.com/zibyn/stars-auth/internal/login"
	"github.com/zibyn/stars-auth/internal/management"
	"github.com/zibyn/stars-auth/internal/oidcstore"
	"github.com/zibyn/stars-auth/internal/server"
)

type env struct {
	t      *testing.T
	pool   *pgxpool.Pool
	issuer string
	keys   *oidcstore.Keys
	owner  string // sub
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
	ids := identity.New(pool, keyring)
	token, err := ids.SetupToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := ids.Bootstrap(ctx, token, "owner", "password1")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(nil)
	t.Cleanup(ts.Close)
	ts.Config.Handler = server.New(pool.Ping, http.NotFoundHandler(), nil, management.New(pool, keyring, ts.URL).Register)
	return &env{t: t, pool: pool, issuer: ts.URL, keys: keys, owner: owner}
}

// user adds a User with the given Identifiers ("kind:value") and Management
// API Roles.
func (e *env) user(sub string, roles []string, idents ...string) {
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
	for _, r := range roles {
		if err := q.AssignRole(ctx, sqlc.AssignRoleParams{UserID: sub, Api: identity.ManagementAPI, Role: r}); err != nil {
			e.t.Fatal(err)
		}
	}
}

// token signs an access token the way the OIDC provider does, with the
// current signing key; edit tweaks the claims and header type.
func (e *env) token(sub string, edit func(claims map[string]any, typ *string)) string {
	e.t.Helper()
	jwks, err := e.keys.JWKS(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	claims := map[string]any{
		"iss": e.issuer, "sub": sub, "aud": identity.ManagementAPI, "client_id": login.ConsoleClientID,
		"iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix(),
	}
	typ := "at+jwt"
	if edit != nil {
		edit(claims, &typ)
	}
	k := jwks.Keys[0]
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: k.Key, KeyID: k.KeyID}},
		(&jose.SignerOptions{}).WithType(jose.ContentType(typ)))
	if err != nil {
		e.t.Fatal(err)
	}
	signed, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		e.t.Fatal(err)
	}
	return signed
}

// get calls the Management API with a bearer token ("" for none) and decodes
// a 200 body into out.
func (e *env) get(token, path string, out any) int {
	e.t.Helper()
	return e.call("GET", token, path, nil, out)
}

// call sends in as a JSON body (when not nil) and decodes a 200 body into out.
func (e *env) call(method, token, path string, in, out any) int {
	e.t.Helper()
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.issuer+management.Prefix+path, body)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 200 && out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s: %v\n%s", path, err, raw)
		}
	}
	return resp.StatusCode
}

type role struct{ API, Key, Name string }

type user struct {
	Sub         string
	Identifiers []struct{ Kind, Value string }
	Roles       []role
	HasPassword bool
}

func subs(users []user) []string {
	var s []string
	for _, u := range users {
		s = append(s, u.Sub)
	}
	slices.Sort(s)
	return s
}

func TestOwnerBrowsesUsers(t *testing.T) {
	e := start(t)
	e.user("ALICE", nil, "phone:+8613800001111", "email:alice@example.com")
	e.user("BOB", []string{"readonly"}, "email:bob@example.com", "username:bobby")
	tok := e.token(e.owner, nil)

	var me struct {
		Sub         string
		Permissions []string
	}
	if code := e.get(tok, "/me", &me); code != 200 || me.Sub != e.owner ||
		!slices.Contains(me.Permissions, "users:read") || !slices.Contains(me.Permissions, "keys:rotate") {
		t.Errorf("me: %d %+v", code, me)
	}

	var list struct{ Users []user }
	for query, want := range map[string][]string{
		"":                               {"ALICE", "BOB", e.owner},
		"?q=13800001111":                 {"ALICE"},
		"?q=Alice@Example":               {"ALICE"},
		"?q=bobby":                       {"BOB"},
		"?q=" + strings.ToLower(e.owner): {e.owner},
		"?q=nobody":                      nil,
		"?role=owner":                    {e.owner},
		"?role=readonly&q=bob":           {"BOB"},
		"?role=admin":                    nil,
		"?api=x&role=owner":              nil,
	} {
		want := slices.Clone(want)
		slices.Sort(want)
		list.Users = nil
		if code := e.get(tok, "/users"+query, &list); code != 200 || !slices.Equal(subs(list.Users), want) {
			t.Errorf("users%s: %d %v, want %v", query, code, subs(list.Users), want)
		}
	}

	// The Roles column.
	e.get(tok, "/users?q=bobby", &list)
	if len(list.Users) != 1 || !slices.Equal(list.Users[0].Roles, []role{{identity.ManagementAPI, "readonly", "只读"}}) {
		t.Errorf("bob's roles: %+v", list.Users)
	}

	var detail user
	if code := e.get(tok, "/users/ALICE", &detail); code != 200 || len(detail.Identifiers) != 2 || detail.HasPassword || len(detail.Roles) != 0 {
		t.Errorf("alice: %d %+v", code, detail)
	}
	if code := e.get(tok, "/users/"+e.owner, &detail); code != 200 || !detail.HasPassword ||
		!slices.Equal(detail.Roles, []role{{identity.ManagementAPI, "owner", "所有者"}}) {
		t.Errorf("owner: %d %+v", code, detail)
	}
	if code := e.get(tok, "/users/NOPE", nil); code != 404 {
		t.Errorf("unknown user: %d", code)
	}

	var roles struct{ Roles []role }
	if code := e.get(tok, "/roles", &roles); code != 200 || len(roles.Roles) != 3 {
		t.Errorf("roles: %d %+v", code, roles)
	}
}

func TestOnlyAdminsWithValidTokens(t *testing.T) {
	e := start(t)
	e.user("CAROL", []string{"readonly"})
	e.user("DAVE", nil)

	for name, tok := range map[string]string{
		"no token":    "",
		"garbage":     "not-a-jwt",
		"wrong aud":   e.token(e.owner, func(c map[string]any, _ *string) { c["aud"] = "https://api.example" }),
		"wrong iss":   e.token(e.owner, func(c map[string]any, _ *string) { c["iss"] = "https://evil.example" }),
		"expired":     e.token(e.owner, func(c map[string]any, _ *string) { c["exp"] = time.Now().Add(-time.Minute).Unix() }),
		"an ID token": e.token(e.owner, func(_ map[string]any, typ *string) { *typ = "JWT" }),
	} {
		if code := e.get(tok, "/users", nil); code != 401 {
			t.Errorf("%s: %d, want 401", name, code)
		}
	}

	if code := e.get(e.token("DAVE", nil), "/users", nil); code != 403 {
		t.Errorf("non-admin: %d, want 403", code)
	}

	// Any Management API Role makes an admin, even one with no Permissions.
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO roles (api, key, name) VALUES ('urn:stars-auth:management-api', 'empty', 'Empty');
		INSERT INTO user_roles VALUES ('DAVE', 'urn:stars-auth:management-api', 'empty')`); err != nil {
		t.Fatal(err)
	}
	dave := e.token("DAVE", nil)
	if code := e.get(dave, "/me", nil); code != 200 {
		t.Errorf("admin without Permissions, /me: %d, want 200", code)
	}
	if code := e.get(dave, "/users", nil); code != 403 {
		t.Errorf("admin without users:read: %d, want 403", code)
	}

	// Roles are read on every request: taking CAROL's away locks her out at
	// once, with the same token.
	carol := e.token("CAROL", nil)
	if code := e.get(carol, "/users", nil); code != 200 {
		t.Fatalf("readonly admin: %d", code)
	}
	if _, err := e.pool.Exec(context.Background(), "DELETE FROM user_roles WHERE user_id = 'CAROL'"); err != nil {
		t.Fatal(err)
	}
	if code := e.get(carol, "/users", nil); code != 403 {
		t.Errorf("after losing her Role: %d, want 403", code)
	}
}

func TestOpenAPIDocument(t *testing.T) {
	e := start(t)
	var doc struct {
		Paths map[string]any
	}
	if code := e.get("", "/openapi.json", &doc); code != 200 || doc.Paths["/users"] == nil || doc.Paths["/users/{sub}"] == nil {
		t.Errorf("openapi: %d %v", code, doc.Paths)
	}
}
