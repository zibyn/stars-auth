-- +goose Up

-- A business API Role can be marked default: every User created after that
-- gets it (docs/spec/rbac.md). Only the Management API and the Account API
-- are built-in, and the Management API rejects marking one there, so new
-- Users never become admins by accident.
ALTER TABLE roles ADD COLUMN default_role boolean NOT NULL DEFAULT false;

-- +goose Down

ALTER TABLE roles DROP COLUMN default_role;
