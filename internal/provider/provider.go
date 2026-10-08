// Package provider signs Users in through Providers: external services that
// say who someone is, giving an External Identity. Each Provider type is a Go
// package that calls Register in its init; a binary gets the types it
// imports (ADR 0004). An admin adds Providers of those types.
package provider

import (
	"context"
	"net/url"
	"slices"

	"github.com/zibyn/stars-auth/internal/channel"
)

// Redirect is a Provider the browser signs in at: the hosted login page sends
// it to AuthURL, and the Provider sends it back to the callback URL. Asks for
// openid only; whatever else the Provider says (email, name) is dropped.
type Redirect interface {
	// AuthURL is where to send the browser, with state, nonce and the PKCE
	// challenge of verifier.
	AuthURL(ctx context.Context, redirectURI, state, nonce, verifier string) (string, error)
	// Callback checks the parameters the Provider sent the browser back with
	// and says who signed in.
	Callback(ctx context.Context, params url.Values, redirectURI, nonce, verifier string) (Identity, error)
}

// Identity is who a Provider says signed in.
type Identity struct {
	Subject string
	// Token, when set, is kept sealed on the External Identity for the
	// Provider type's own use (Apple revokes its refresh token on unbinding).
	Token string
}

// ConfigField is one setting a Provider type needs, shaped like a Channel's.
type ConfigField struct {
	channel.Field
	Immutable bool `json:"immutable" doc:"Set when the Provider is added, never changed: it anchors the External Identities"`
}

type Type struct {
	Key    string        `json:"key"`
	Name   string        `json:"name"`
	Fields []ConfigField `json:"fields"`
	// New builds a Provider from settings that passed the Fields checks,
	// without network calls. Its errors are shown to the admin.
	New func(config map[string]string) (Redirect, error) `json:"-"`
}

var types []Type

// Register adds a Provider type; call it from init.
func Register(t Type) { types = append(types, t) }

// Types lists the registered Provider types.
func Types() []Type { return types }

// GetType returns the Provider type named key, or nil.
func GetType(key string) *Type {
	i := slices.IndexFunc(types, func(t Type) bool { return t.Key == key })
	if i < 0 {
		return nil
	}
	return &types[i]
}

// CallbackURL is where a Provider sends the browser back to.
func CallbackURL(issuer, id string) string {
	return issuer + "/login/providers/" + id + "/callback"
}
