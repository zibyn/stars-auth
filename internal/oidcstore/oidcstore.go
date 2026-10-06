// Package oidcstore keeps the OIDC protocol layer's state in PostgreSQL:
// Applications as clients, grants and sessions, and the signing keys.
package oidcstore

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
)

// Store implements the go-oidc storage interfaces.
type Store struct {
	q       *sqlc.Queries
	keyring *crypt.Keyring
	// Scopes every Application may request, space-separated.
	Scopes string
	// GrantTTL keeps a grant around for the tokens issued from it when no
	// longer-lived secret (auth code, refresh token) does; at least the
	// access token lifetime.
	GrantTTL time.Duration
}

var (
	_ goidc.ClientManager       = (*Store)(nil)
	_ goidc.GrantManager        = (*Store)(nil)
	_ goidc.AuthManager         = (*Store)(nil)
	_ goidc.RefreshTokenManager = (*Store)(nil)
	_ goidc.LogoutManager       = (*Store)(nil)
)

func New(pool *pgxpool.Pool, keyring *crypt.Keyring) *Store {
	return &Store{q: sqlc.New(pool), keyring: keyring, GrantTTL: time.Hour}
}

// DeleteExpired removes expired grants and sessions; run by the hourly cleanup.
func DeleteExpired(ctx context.Context, pool *pgxpool.Pool) error {
	return sqlc.New(pool).DeleteExpiredOIDC(ctx)
}

// Client resolves an Application. Confidential Applications authenticate with
// their secret (basic or post); public ones with PKCE only.
func (s *Store) Client(ctx context.Context, id string) (*goidc.Client, error) {
	app, err := s.q.Application(ctx, id)
	if err != nil {
		return nil, notFound(err)
	}
	c := &goidc.Client{
		ID: app.ClientID,
		ClientMeta: goidc.ClientMeta{
			Name:                   app.Name,
			TokenAuthnMethod:       goidc.AuthnMethodNone,
			RedirectURIs:           app.RedirectUris,
			PostLogoutRedirectURIs: app.PostLogoutRedirectUris,
			GrantTypes:             []goidc.GrantType{goidc.GrantAuthorizationCode, goidc.GrantRefreshToken},
			ResponseTypes:          []goidc.ResponseType{goidc.ResponseTypeCode},
			ScopeIDs:               s.Scopes,
		},
	}
	if app.Type == "confidential" {
		c.TokenAuthnMethod = goidc.AuthnMethodSecretBasic
		c.Secret = hex.EncodeToString(app.SecretHash)
	}
	return c, nil
}

// Application is what CreateApplication needs; a Secret makes it confidential.
type Application struct {
	ClientID               string
	Name                   string
	Secret                 string
	RedirectURIs           []string
	PostLogoutRedirectURIs []string
}

func CreateApplication(ctx context.Context, pool *pgxpool.Pool, app Application) error {
	params := sqlc.CreateApplicationParams{
		ClientID:               app.ClientID,
		Name:                   app.Name,
		Type:                   "public",
		RedirectUris:           app.RedirectURIs,
		PostLogoutRedirectUris: app.PostLogoutRedirectURIs,
	}
	if app.Secret != "" {
		params.Type = "confidential"
		params.SecretHash = hash(app.Secret)
	}
	return sqlc.New(pool).CreateApplication(ctx, params)
}

// VerifyClientSecret checks a presented secret against the stored hash (the
// hex Client.Secret); plug it in with provider.WithClientSecretVerifier.
func VerifyClientSecret(_ context.Context, stored, presented string) error {
	want, err := hex.DecodeString(stored)
	if err != nil || subtle.ConstantTimeCompare(want, hash(presented)) != 1 {
		return errors.New("invalid client secret")
	}
	return nil
}

func (s *Store) SaveGrant(ctx context.Context, g *goidc.Grant) error {
	data, err := json.Marshal(g)
	if err != nil {
		return err
	}
	sealed, err := s.keyring.Seal(data, grantAAD(g.ID))
	if err != nil {
		return err
	}
	return s.q.SaveGrant(ctx, sqlc.SaveGrantParams{
		ID:               g.ID,
		AuthCodeHash:     hash(g.AuthCode),
		RefreshTokenHash: hash(g.RefreshToken),
		ExpiresAt:        s.grantExpiry(g),
		Sealed:           sealed,
	})
}

func (s *Store) grantExpiry(g *goidc.Grant) pgtype.Timestamptz {
	if g.RefreshToken != "" && g.RefreshTokenExpiresAt == 0 {
		return pgtype.Timestamptz{} // lives as long as its refresh token
	}
	exp := max(time.Now().Add(s.GrantTTL).Unix(), int64(g.AuthCodeExpiresAt), int64(g.RefreshTokenExpiresAt))
	return pgtype.Timestamptz{Time: time.Unix(exp, 0), Valid: true}
}

func (s *Store) Grant(ctx context.Context, id string) (*goidc.Grant, error) {
	return s.openGrant(s.q.Grant(ctx, id))
}

func (s *Store) GrantByAuthCode(ctx context.Context, code string) (*goidc.Grant, error) {
	return s.openGrant(s.q.GrantByAuthCodeHash(ctx, hash(code)))
}

func (s *Store) GrantByRefreshToken(ctx context.Context, token string) (*goidc.Grant, error) {
	return s.openGrant(s.q.GrantByRefreshTokenHash(ctx, hash(token)))
}

func (s *Store) openGrant(row sqlc.OidcGrant, err error) (*goidc.Grant, error) {
	if err != nil {
		return nil, notFound(err)
	}
	data, err := s.keyring.Open(row.Sealed, grantAAD(row.ID))
	if err != nil {
		return nil, err
	}
	var g goidc.Grant
	if err := json.Unmarshal(data, &g); err != nil {
		return nil, err
	}
	ints(g.Store)
	return &g, nil
}

// SaveSession stores go-oidc's in-flight authorization state; not a
// glossary Session (a User's login on a device).
func (s *Store) SaveSession(ctx context.Context, as *goidc.AuthnSession) error {
	data, err := json.Marshal(as)
	if err != nil {
		return err
	}
	return s.q.SaveAuthnSession(ctx, sqlc.SaveAuthnSessionParams{ID: as.ID, ExpiresAt: unix(as.ExpiresAt), Data: data})
}

func (s *Store) Session(ctx context.Context, id string) (*goidc.AuthnSession, error) {
	data, err := s.q.AuthnSession(ctx, id)
	if err != nil {
		return nil, notFound(err)
	}
	var as goidc.AuthnSession
	if err := json.Unmarshal(data, &as); err != nil {
		return nil, err
	}
	ints(as.Store)
	return &as, nil
}

func (s *Store) SaveLogoutSession(ctx context.Context, ls *goidc.LogoutSession) error {
	data, err := json.Marshal(ls)
	if err != nil {
		return err
	}
	return s.q.SaveLogoutSession(ctx, sqlc.SaveLogoutSessionParams{ID: ls.ID, ExpiresAt: unix(ls.ExpiresAt), Data: data})
}

func (s *Store) LogoutSession(ctx context.Context, id string) (*goidc.LogoutSession, error) {
	data, err := s.q.LogoutSession(ctx, id)
	if err != nil {
		return nil, notFound(err)
	}
	var ls goidc.LogoutSession
	return &ls, json.Unmarshal(data, &ls)
}

// ints turns integral numbers in a decoded Store back into int64. JSON has one
// number type, and claims kept there (auth_time) are re-signed later: go-jose
// would write a float64 as 1.791302791e+09, which is not a NumericDate.
func ints(v any) any {
	switch v := v.(type) {
	case float64:
		if v == math.Trunc(v) && math.Abs(v) <= 1<<53 {
			return int64(v)
		}
	case map[string]any:
		for k, e := range v {
			v[k] = ints(e)
		}
	case []any:
		for i, e := range v {
			v[i] = ints(e)
		}
	}
	return v
}

// hash indexes a bearer secret; nil (SQL NULL) when there is none.
func hash(secret string) []byte {
	if secret == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

func grantAAD(id string) []byte { return []byte("oidc_grant:" + id) }

func unix(secs int) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Unix(int64(secs), 0), Valid: true}
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return goidc.ErrNotFound
	}
	return err
}
