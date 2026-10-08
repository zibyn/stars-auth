-- +goose Up

-- 两步验证 (docs/spec/identity.md): a User's one TOTP Credential. secret is
-- sealed with the master key (aad "totp:<user id>"); with no confirmed_at the
-- User is still adding it to an authenticator and 两步验证 is off. A code is
-- accepted only for a time step after last_step, so none is used twice.
CREATE TABLE totp_credentials (
    user_id      text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    secret       bytea NOT NULL,
    confirmed_at timestamptz,
    last_step    bigint NOT NULL DEFAULT 0
);

-- A User's 恢复码, each kept as an HMAC-SHA256 under the master key
-- (crypt.Keyring.MAC); a used one stays, with used_at, until the set is
-- replaced.
CREATE TABLE recovery_codes (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    mac     bytea NOT NULL,
    used_at timestamptz,
    PRIMARY KEY (user_id, mac)
);
