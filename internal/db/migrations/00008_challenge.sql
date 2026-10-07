-- +goose Up

-- The auth_session of the direct auth API (docs/spec/protocol.md#直连认证-api):
-- a sign-in in progress across challenge requests, by SHA-256 of the bearer
-- value. Deleted once it yields an authorization code, or by the hourly
-- cleanup when it expires.
CREATE TABLE oidc_challenge_sessions (
    hash       bytea PRIMARY KEY,
    client_id  text NOT NULL REFERENCES applications (client_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    data       jsonb NOT NULL
);
CREATE INDEX ON oidc_challenge_sessions (expires_at);
