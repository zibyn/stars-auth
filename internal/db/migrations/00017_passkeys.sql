-- +goose Up

-- A User's Passkeys (GLOSSARY.md): their WebAuthn credentials.
-- public_key is the COSE key, not a secret. last_used_at moves on each
-- login with the Passkey; a null one has never been used.
CREATE TABLE passkeys (
    id             text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
    user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id  bytea NOT NULL UNIQUE,
    public_key     bytea NOT NULL,
    sign_count     bigint NOT NULL,
    aaguid         uuid NOT NULL,
    backup_eligible boolean NOT NULL,
    backup_state   boolean NOT NULL,
    transports     text[] NOT NULL DEFAULT '{}',
    name           text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_used_at   timestamptz
);
CREATE INDEX ON passkeys (user_id);

-- The challenge of an account center registration in flight, one per
-- Session; replaced by beginning again, taken by finishing, deleted by the
-- hourly cleanup when it expires.
CREATE TABLE passkey_challenges (
    session_id text PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    challenge  text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX ON passkey_challenges (expires_at);
