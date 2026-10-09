-- +goose Up

-- A redirect to a Provider from the account center: session_id is the
-- Session it was started in, to bind the External Identity to its User, or
-- with reauth, to reauthenticate it. authn_session is '' for these.
-- created_at is when it started: a reauthentication must be newer.
ALTER TABLE provider_logins
    ADD COLUMN session_id text REFERENCES sessions (id) ON DELETE CASCADE,
    ADD COLUMN reauth     boolean NOT NULL DEFAULT false,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
