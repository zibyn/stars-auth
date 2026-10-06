package oidcstore

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zibyn/stars-auth/internal/crypt"
	"github.com/zibyn/stars-auth/internal/db/sqlc"
	"github.com/zibyn/stars-auth/internal/oidc/goidc"
)

// Keys holds the RS256 signing keys, sealed with the master key. The newest
// key signs; the previous one stays published so tokens it signed verify
// until they expire.
type Keys struct {
	q       *sqlc.Queries
	keyring *crypt.Keyring
}

func NewKeys(pool *pgxpool.Pool, keyring *crypt.Keyring) *Keys {
	return &Keys{q: sqlc.New(pool), keyring: keyring}
}

// Ensure creates the first signing key if there is none. Replicas starting
// together may each create one; that is harmless, the newest signs.
func (k *Keys) Ensure(ctx context.Context) error {
	keys, err := k.q.SigningKeys(ctx)
	if err != nil || len(keys) > 0 {
		return err
	}
	return k.add(ctx)
}

// Rotate makes a new key current and retires all but the previous one.
// ponytail: rotating twice within an access token lifetime (10 min) cuts off
// tokens from the retired key; guard in the console if that bites.
func (k *Keys) Rotate(ctx context.Context) error {
	if err := k.add(ctx); err != nil {
		return err
	}
	return k.q.DeleteRetiredSigningKeys(ctx)
}

// JWKS returns the published keys with their private halves, newest first:
// go-oidc signs with the first RS256 key and strips private parts when serving.
// ponytail: reads PG on every call; cache for a few seconds if it shows up in profiles.
func (k *Keys) JWKS(ctx context.Context) (goidc.JSONWebKeySet, error) {
	rows, err := k.q.SigningKeys(ctx)
	if err != nil {
		return goidc.JSONWebKeySet{}, err
	}
	var jwks goidc.JSONWebKeySet
	for _, row := range rows {
		der, err := k.keyring.Open(row.Sealed, keyAAD(row.Kid))
		if err != nil {
			return goidc.JSONWebKeySet{}, err
		}
		key, err := x509.ParsePKCS8PrivateKey(der)
		if err != nil {
			return goidc.JSONWebKeySet{}, err
		}
		jwks.Keys = append(jwks.Keys, goidc.JSONWebKey{
			Key:       key,
			KeyID:     row.Kid,
			Algorithm: string(goidc.SigAlgRS256),
			Use:       string(goidc.KeyUsageSignature),
		})
	}
	return jwks, nil
}

func (k *Keys) add(ctx context.Context) error {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return err
	}
	kid := rand.Text()
	sealed, err := k.keyring.Seal(der, keyAAD(kid))
	if err != nil {
		return err
	}
	return k.q.InsertSigningKey(ctx, sqlc.InsertSigningKeyParams{Kid: kid, Sealed: sealed})
}

func keyAAD(kid string) []byte { return []byte("signing_key:" + kid) }
