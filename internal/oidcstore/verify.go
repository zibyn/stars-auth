package oidcstore

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

var ErrToken = errors.New("invalid access token")

// AccessToken is who an access token speaks for, and the Session it was
// issued in ("" for none).
type AccessToken struct {
	Subject, SessionID string
}

// Verify checks an Authorization header's bearer RFC 9068 access token,
// issued by issuer for audience ("" for any).
func (k *Keys) Verify(ctx context.Context, issuer, audience, header string) (AccessToken, error) {
	raw, ok := strings.CutPrefix(header, "Bearer ")
	if !ok {
		return AccessToken{}, ErrToken
	}
	tok, err := jwt.ParseSigned(raw, []jose.SignatureAlgorithm{jose.RS256})
	if err != nil {
		return AccessToken{}, ErrToken
	}
	// typ keeps ID tokens, signed by the same key, out.
	typ, _ := tok.Headers[0].ExtraHeaders[jose.HeaderType].(string)
	if !strings.EqualFold(strings.TrimPrefix(typ, "application/"), "at+jwt") {
		return AccessToken{}, ErrToken
	}
	jwks, err := k.JWKS(ctx)
	if err != nil {
		return AccessToken{}, err
	}
	set := jose.JSONWebKeySet{Keys: jwks.Keys}
	keys := set.Key(tok.Headers[0].KeyID)
	if len(keys) == 0 {
		return AccessToken{}, ErrToken
	}
	var c jwt.Claims
	var extra struct {
		SID string `json:"sid"`
	}
	if err := tok.Claims(keys[0].Public().Key, &c, &extra); err != nil {
		return AccessToken{}, ErrToken
	}
	want := jwt.Expected{Issuer: issuer, Time: time.Now()}
	if audience != "" {
		want.AnyAudience = jwt.Audience{audience}
	}
	if err := c.ValidateWithLeeway(want, 0); err != nil || c.Expiry == nil || c.Subject == "" {
		return AccessToken{}, ErrToken
	}
	return AccessToken{Subject: c.Subject, SessionID: extra.SID}, nil
}
