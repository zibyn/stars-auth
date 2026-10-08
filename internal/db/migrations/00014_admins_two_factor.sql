-- +goose Up

-- 管理员必须启用两步验证 (docs/spec/authentication.md#2fa二期): while on,
-- a User holding a Management API Role can't use it without 两步验证.
ALTER TABLE settings ADD COLUMN admins_need_two_factor boolean NOT NULL DEFAULT false;
