package oidc_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"github.com/zibyn/stars-auth/internal/provider"
	_ "github.com/zibyn/stars-auth/internal/provider/oidc"
)

// fakeIssuer answers discovery, the JWKS and a token endpoint that returns
// whatever id_token claims() makes, signed with its key; it checks the
// client's secret and PKCE verifier.
func fakeIssuer(t *testing.T, claims func(iss string) map[string]any) string {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	var iss string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"issuer": iss, "authorization_endpoint": iss + "/auth", "token_endpoint": iss + "/token", "jwks_uri": iss + "/jwks",
			})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			id, secret, _ := r.BasicAuth()
			if id != "cid" || secret != "shh" || r.PostFormValue("code_verifier") != "verifier" || r.PostFormValue("code") != "good" {
				http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
				return
			}
			signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "k1"}}, nil)
			tok, _ := jwt.Signed(signer).Claims(claims(iss)).Serialize()
			_ = json.NewEncoder(w).Encode(map[string]string{"id_token": tok, "access_token": "x", "token_type": "Bearer"})
		}
	}))
	t.Cleanup(ts.Close)
	iss = ts.URL
	return iss
}

func good(iss string) map[string]any {
	return map[string]any{"iss": iss, "sub": "u1", "aud": "cid", "exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix(), "nonce": "n"}
}

func newUpstream(t *testing.T, iss string) provider.Redirect {
	t.Helper()
	p, err := provider.GetType("oidc").New(map[string]string{"issuer": iss, "client_id": "cid", "client_secret": "shh"})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAuthURLAsksForOpenIDOnlyWithPKCE(t *testing.T) {
	iss := fakeIssuer(t, good)
	to, err := newUpstream(t, iss).AuthURL(context.Background(), "https://auth.example/cb", "st", "n", "verifier")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	q := u.Query()
	sum := sha256.Sum256([]byte("verifier"))
	if !strings.HasPrefix(to, iss+"/auth?") || q.Get("scope") != "openid" || q.Get("state") != "st" || q.Get("nonce") != "n" ||
		q.Get("client_id") != "cid" || q.Get("redirect_uri") != "https://auth.example/cb" || q.Get("response_type") != "code" ||
		q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") != base64.RawURLEncoding.EncodeToString(sum[:]) {
		t.Errorf("auth URL: %s", to)
	}
}

func TestCallbackChecksTheIDToken(t *testing.T) {
	for name, tc := range map[string]struct {
		edit   func(map[string]any)
		params url.Values
	}{
		"good":           {},
		"wrong issuer":   {edit: func(c map[string]any) { c["iss"] = "https://evil.example" }},
		"wrong audience": {edit: func(c map[string]any) { c["aud"] = "other" }},
		"expired":        {edit: func(c map[string]any) { c["exp"] = time.Now().Add(-time.Hour).Unix() }},
		"no exp":         {edit: func(c map[string]any) { delete(c, "exp") }},
		"wrong nonce":    {edit: func(c map[string]any) { c["nonce"] = "other" }},
		"azp not us":     {edit: func(c map[string]any) { c["aud"], c["azp"] = []string{"cid", "other"}, "other" }},
		"bad code":       {params: url.Values{"code": {"bad"}}},
		"error":          {params: url.Values{"error": {"access_denied"}}},
		"another issuer": {params: url.Values{"code": {"good"}, "iss": {"https://evil.example"}}},
	} {
		t.Run(name, func(t *testing.T) {
			iss := fakeIssuer(t, func(iss string) map[string]any {
				c := good(iss)
				if tc.edit != nil {
					tc.edit(c)
				}
				return c
			})
			params := tc.params
			if params == nil {
				params = url.Values{"code": {"good"}}
			}
			id, err := newUpstream(t, iss).Callback(context.Background(), params, "https://auth.example/cb", "n", "verifier")
			if name == "good" {
				if err != nil || id.Subject != "u1" {
					t.Errorf("good: %+v %v", id, err)
				}
			} else if err == nil {
				t.Errorf("accepted: %+v", id)
			}
		})
	}
}
