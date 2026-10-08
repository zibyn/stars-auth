// Package oidc is the generic OIDC Provider type: any upstream with
// discovery, signed in to by authorization code + PKCE, its id_token checked
// against the issuer's JWKS (docs/spec/architecture.md#通用-oidc-provider-类型).
package oidc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"github.com/zibyn/stars-auth/internal/channel"
	"github.com/zibyn/stars-auth/internal/provider"
)

func init() {
	provider.Register(provider.Type{
		Key:  "oidc",
		Name: "通用 OIDC",
		Fields: []provider.ConfigField{
			{Field: channel.Field{Key: "issuer", Label: "Issuer", Type: "url",
				Help: "须提供 /.well-known/openid-configuration"}, Immutable: true},
			{Field: channel.Field{Key: "client_id", Label: "Client ID", Type: "text"}},
			{Field: channel.Field{Key: "client_secret", Label: "Client secret", Type: "text", Secret: true}},
		},
		New: func(c map[string]string) (provider.Redirect, error) {
			return &upstream{issuer: strings.TrimSuffix(c["issuer"], "/"), clientID: c["client_id"], secret: c["client_secret"]}, nil
		},
	})
}

type upstream struct{ issuer, clientID, secret string }

var client = &http.Client{Timeout: 10 * time.Second}

func (u *upstream) AuthURL(ctx context.Context, redirectURI, state, nonce, verifier string) (string, error) {
	d, err := discover(ctx, u.issuer)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {u.clientID},
		"redirect_uri":          {redirectURI},
		"scope":                 {"openid"},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	sep := "?"
	if strings.Contains(d.AuthorizationEndpoint, "?") {
		sep = "&"
	}
	return d.AuthorizationEndpoint + sep + q.Encode(), nil
}

func (u *upstream) Callback(ctx context.Context, params url.Values, redirectURI, nonce, verifier string) (provider.Identity, error) {
	if e := params.Get("error"); e != "" {
		return provider.Identity{}, fmt.Errorf("upstream: %s %s", e, params.Get("error_description"))
	}
	if iss := params.Get("iss"); iss != "" && iss != u.issuer { // RFC 9207
		return provider.Identity{}, fmt.Errorf("callback from issuer %q", iss)
	}
	d, err := discover(ctx, u.issuer)
	if err != nil {
		return provider.Identity{}, err
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {params.Get("code")},
		"redirect_uri":  {redirectURI},
		"code_verifier": {verifier},
	}
	// client_secret_basic is the default; post only for an upstream without it.
	post := len(d.TokenAuthMethods) > 0 && !slices.Contains(d.TokenAuthMethods, "client_secret_basic")
	if post {
		form.Set("client_id", u.clientID)
		form.Set("client_secret", u.secret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return provider.Identity{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if !post {
		req.SetBasicAuth(url.QueryEscape(u.clientID), url.QueryEscape(u.secret)) // RFC 6749 §2.3.1
	}
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := fetch(req, &tok); err != nil {
		return provider.Identity{}, fmt.Errorf("token endpoint: %w", err)
	}
	sub, err := u.verify(ctx, d, tok.IDToken, nonce)
	return provider.Identity{Subject: sub}, err
}

// verify checks an id_token from the token endpoint (OIDC Core §3.1.3.7)
// and returns its sub.
func (u *upstream) verify(ctx context.Context, d *discovery, idToken, nonce string) (string, error) {
	algs := []jose.SignatureAlgorithm{}
	for _, a := range d.SigningAlgs {
		if a != "none" && !strings.HasPrefix(a, "HS") { // never the alg the token picks for itself
			algs = append(algs, jose.SignatureAlgorithm(a))
		}
	}
	if len(algs) == 0 {
		algs = []jose.SignatureAlgorithm{jose.RS256}
	}
	tok, err := jwt.ParseSigned(idToken, algs)
	if err != nil {
		return "", fmt.Errorf("id_token: %w", err)
	}
	if len(tok.Headers) != 1 {
		return "", errors.New("id_token: one signature expected")
	}
	key, err := d.key(ctx, tok.Headers[0].KeyID)
	if err != nil {
		return "", err
	}
	var claims jwt.Claims
	var extra struct {
		Nonce string `json:"nonce"`
		AZP   string `json:"azp"`
	}
	if err := tok.Claims(key, &claims, &extra); err != nil {
		return "", fmt.Errorf("id_token: %w", err)
	}
	if err := claims.ValidateWithLeeway(jwt.Expected{Issuer: u.issuer, AnyAudience: jwt.Audience{u.clientID}}, time.Minute); err != nil {
		return "", fmt.Errorf("id_token: %w", err)
	}
	if claims.Expiry == nil {
		return "", errors.New("id_token: no exp")
	}
	if len(claims.Audience) > 1 && extra.AZP != u.clientID {
		return "", errors.New("id_token: azp is not us")
	}
	if extra.Nonce != nonce {
		return "", errors.New("id_token: wrong nonce")
	}
	if claims.Subject == "" {
		return "", errors.New("id_token: no sub")
	}
	return claims.Subject, nil
}

// discovery is an issuer's /.well-known/openid-configuration, with its
// JWKS once fetched.
type discovery struct {
	Issuer                string   `json:"issuer"`
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	JWKSURI               string   `json:"jwks_uri"`
	SigningAlgs           []string `json:"id_token_signing_alg_values_supported"`
	TokenAuthMethods      []string `json:"token_endpoint_auth_methods_supported"`

	fetched time.Time
	mu      sync.Mutex
	jwks    jose.JSONWebKeySet
	jwksAt  time.Time
}

// cacheFor is how long a discovery document and JWKS are reused.
const cacheFor = time.Hour

// cache holds each issuer's discovery, in this process only.
var cache sync.Map // issuer → *discovery

func discover(ctx context.Context, issuer string) (*discovery, error) {
	if v, ok := cache.Load(issuer); ok && time.Since(v.(*discovery).fetched) < cacheFor {
		return v.(*discovery), nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, issuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return nil, err
	}
	d := &discovery{}
	if err := fetch(req, d); err != nil {
		return nil, fmt.Errorf("discovery: %w", err)
	}
	if d.Issuer != issuer || d.AuthorizationEndpoint == "" || d.TokenEndpoint == "" || d.JWKSURI == "" {
		return nil, fmt.Errorf("discovery of %s: wrong issuer or endpoints missing", issuer)
	}
	d.fetched = time.Now()
	cache.Store(issuer, d)
	return d, nil
}

// key returns the signing key kid names, fetching the JWKS again when it is
// not there: the upstream rotated keys.
// ponytail: an unknown kid refetches at most once a minute; enough for one
// upstream's rotations, not a defence against a flood of forged kids.
func (d *discovery) key(ctx context.Context, kid string) (*jose.JSONWebKey, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	find := func() *jose.JSONWebKey {
		for _, k := range d.jwks.Keys {
			if (kid == "" || k.KeyID == kid) && k.Use != "enc" {
				return &k
			}
		}
		return nil
	}
	if k := find(); k != nil && time.Since(d.jwksAt) < cacheFor {
		return k, nil
	}
	if time.Since(d.jwksAt) > time.Minute {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.JWKSURI, nil)
		if err != nil {
			return nil, err
		}
		var set jose.JSONWebKeySet
		if err := fetch(req, &set); err != nil {
			return nil, fmt.Errorf("jwks: %w", err)
		}
		d.jwks, d.jwksAt = set, time.Now()
	}
	if k := find(); k != nil {
		return k, nil
	}
	return nil, fmt.Errorf("id_token: no key %q in the issuer's JWKS", kid)
}

func fetch(req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close() //nolint:errcheck
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %.200s", resp.Status, body)
	}
	return json.Unmarshal(body, out)
}
