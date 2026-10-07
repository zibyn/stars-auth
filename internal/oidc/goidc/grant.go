package goidc

import (
	"context"
)

// Grant represents the granted access an entity (a user or the client itself) gave to a client.
type Grant struct {
	ID        string `json:"id"`
	CreatedAt int    `json:"created_at"`
	RevokedAt int    `json:"revoked_at,omitempty"`
	Subject   string `json:"sub"`
	ClientID  string `json:"client_id"`
	// Username is a human-readable identifier for the resource owner. See [RFC 7662 §2.2].
	Username    string       `json:"username,omitempty"`
	Scopes      string       `json:"scopes,omitempty"`
	AuthDetails []AuthDetail `json:"auth_details,omitempty"`
	Resources   Resources    `json:"resources,omitempty"`

	// RefreshToken, if present, is the plain text refresh token issued for this grant.
	// Note: For security reasons, it is strongly recommended to encrypt this value before storing it in a database.
	RefreshToken string `json:"refresh_token,omitempty"`
	// RefreshTokenExpiresAt stores the expiry deadline of the refresh token
	// issued for this grant.
	// A value of 0 means the refresh token does not expire.
	RefreshTokenExpiresAt int `json:"refresh_token_expires_at,omitempty"`
	// PreviousRefreshToken is set, never stored, while a rotation is being
	// saved: the token the request presented, so the storage can save the
	// rotation only if that token is still the current one.
	PreviousRefreshToken string `json:"-"`
	// AuthParams stores the authorization request parameters that must remain
	// available after the grant is created, such as nonce, redirect URI, PKCE,
	// prompt, and resource values used during token issuance and validation.
	AuthParams AuthorizationParameters `json:"auth_params,omitzero"`
	// AuthCode is populated when the grant is issued from the authorization
	// code flow. It is the code later redeemed at the token endpoint.
	AuthCode string `json:"auth_code,omitempty"`
	// AuthCodeExpiresAt stores the original authorization code expiry deadline,
	// so redemption remains bounded by that window independently of grant
	// creation time.
	AuthCodeExpiresAt int `json:"auth_code_expires_at,omitempty"`
	// AuthCodeConsumedAt is populated once the authorization code has been
	// successfully redeemed, so reuse can be detected.
	AuthCodeConsumedAt int `json:"auth_code_consumed_at,omitempty"`
	// JWKThumbprint stores the thumbprint of the JWK provided via DPoP.
	JWKThumbprint string `json:"jwk_thumbprint,omitempty"`
	// Store allows storing custom data within the grant.
	Store map[string]any `json:"store,omitempty"`
}

type HandleGrantFunc func(context.Context, GrantType, *Grant) error
