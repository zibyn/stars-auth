-- +goose Up

-- Sessions (docs/spec/protocol.md#session). A browser Session has a cookie
-- (id_hash); an App Session has none and is its refresh token chain. Either
-- dies idle_timeout after last_seen_at or when ended_at is set, and is kept
-- 30 days after that, then deleted by the hourly cleanup.
ALTER TABLE sessions DROP CONSTRAINT sessions_pkey;
ALTER TABLE sessions ADD COLUMN id text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE sessions ADD PRIMARY KEY (id);
ALTER TABLE sessions
    ALTER COLUMN id_hash DROP NOT NULL,
    ADD CONSTRAINT sessions_id_hash_key UNIQUE (id_hash),
    -- The Application the Session was started for. No foreign key: a browser
    -- Session outlives the Application it started from.
    ADD COLUMN client_id text,
    ADD COLUMN idle_timeout interval NOT NULL DEFAULT '30 days',
    ADD COLUMN ended_at timestamptz;

CREATE VIEW live_sessions AS
SELECT id FROM sessions WHERE ended_at IS NULL AND last_seen_at + idle_timeout > now();

-- A grant issued in a Session is usable only while that Session lives.
ALTER TABLE oidc_grants ADD COLUMN session_id text REFERENCES sessions (id) ON DELETE CASCADE;
CREATE INDEX ON oidc_grants (session_id);

-- Refresh tokens a rotation replaced; one presented again ends its Session.
CREATE TABLE oidc_spent_refresh_tokens (
    hash     bytea PRIMARY KEY,
    grant_id text NOT NULL REFERENCES oidc_grants (id) ON DELETE CASCADE
);
CREATE INDEX ON oidc_spent_refresh_tokens (grant_id);

ALTER TABLE applications ADD COLUMN refresh_tokens boolean NOT NULL DEFAULT true;
