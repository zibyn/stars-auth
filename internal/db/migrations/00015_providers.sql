-- +goose Up

-- Providers an admin added (docs/spec/architecture.md#provider-的配置与身份).
-- id is the admin's slug, in the callback URL and the direct auth API; it
-- and an identity anchor among the settings (the generic OIDC issuer) never
-- change. The hosted page lists enabled ones by created_at.
CREATE TABLE providers (
    id         text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
    type       text NOT NULL,
    name       text NOT NULL,
    enabled    boolean NOT NULL DEFAULT true,
    -- Settings that are not secret, as the Provider type's fields name them.
    config     jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Secret settings, sealed with the master key (aad "provider:<id>:<field>").
CREATE TABLE provider_secrets (
    provider   text NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
    field      text NOT NULL,
    value      bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, field)
);

-- A User's External Identities, at most one per Provider. The Provider
-- reference does not cascade: a Provider with bindings cannot be deleted.
-- token is what the Provider type keeps for unbinding (Apple's refresh
-- token), sealed with the master key (aad "external_identity:<provider>:<subject>").
CREATE TABLE external_identities (
    provider   text NOT NULL REFERENCES providers (id),
    subject    text NOT NULL,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token      bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);

-- A redirect to a Provider in flight, found again by the SHA-256 of its
-- state: Apple's form_post callback is a cross-site POST, which carries no
-- Lax cookie. authn_session is the OIDC authorization it signs in for.
CREATE TABLE provider_logins (
    state_hash    bytea PRIMARY KEY,
    provider      text NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
    nonce         text NOT NULL,
    verifier      text NOT NULL,
    authn_session text NOT NULL,
    expires_at    timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX ON provider_logins (expires_at);
