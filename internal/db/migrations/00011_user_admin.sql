-- +goose Up

-- A disabled User cannot sign in and has no live Session
-- (docs/spec/identity.md#管理员对-user-的操作).
ALTER TABLE users ADD COLUMN disabled_at timestamptz;

-- Failed logins (docs/spec/security-compliance.md#失败锁定), by key:
-- 'sub:<sub>' counts a User's wrong passwords since their last right one,
-- 'ip:<ip>' a client's wrong passwords and codes. Day-old rows are deleted
-- by the hourly cleanup.
CREATE TABLE login_failures (
    key text NOT NULL,
    at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON login_failures (key, at);
CREATE INDEX ON login_failures (at);

-- Locked out until: a User's password login, or every login from an IP.
CREATE TABLE lockouts (
    key   text PRIMARY KEY,
    until timestamptz NOT NULL
);

-- The console lists audit events newest first, all or one User's.
CREATE INDEX ON audit_log (at);
CREATE INDEX ON audit_log (sub, at);
