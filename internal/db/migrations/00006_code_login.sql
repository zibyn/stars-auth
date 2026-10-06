-- +goose Up

-- The live verification code of each phone number or email; sending a new
-- one replaces it. Six digits gain nothing from hashing.
CREATE TABLE codes (
    identifier text PRIMARY KEY,
    code       text NOT NULL,
    attempts   integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
);

-- One row per code sent, counted by the send rate limits; kept a day.
CREATE TABLE sends (
    identifier text NOT NULL,
    ip         text NOT NULL,
    sent_at    timestamptz NOT NULL
);
CREATE INDEX ON sends (identifier, sent_at);
CREATE INDEX ON sends (ip, sent_at);
CREATE INDEX ON sends (sent_at);

-- ALTCHA challenges already solved, by signature, so a solution is good once.
CREATE TABLE pow_spent (
    signature  text PRIMARY KEY,
    expires_at timestamptz NOT NULL
);

CREATE TABLE audit_log (
    id     bigserial PRIMARY KEY,
    at     timestamptz NOT NULL DEFAULT now(),
    event  text NOT NULL,
    sub    text,
    detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON audit_log (event, at);

ALTER TABLE settings
    ADD COLUMN daily_send_limit integer NOT NULL DEFAULT 1000 CHECK (daily_send_limit >= 0),
    ADD COLUMN require_phone boolean NOT NULL DEFAULT false,
    -- Signs ALTCHA challenges. Leaking it only lets a bot skip the PoW.
    ADD COLUMN pow_secret text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
