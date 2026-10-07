-- +goose Up

-- Login policy the console edits (docs/spec/consoles.md). The terms are
-- hosted elsewhere; an empty version means none to agree to yet.
ALTER TABLE settings
    ADD COLUMN terms_url text NOT NULL DEFAULT '',
    ADD COLUMN privacy_url text NOT NULL DEFAULT '',
    ADD COLUMN terms_version text NOT NULL DEFAULT '',
    ADD COLUMN audit_retention_days integer NOT NULL DEFAULT 180 CHECK (audit_retention_days > 0);

-- Every time a User agrees to the terms (docs/spec/security-compliance.md#协议同意);
-- deleted with the User.
CREATE TABLE consents (
    user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    version   text NOT NULL,
    client_id text NOT NULL,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON consents (user_id, version);
