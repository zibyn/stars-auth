-- +goose Up

-- Whether the instance offers Passkey login (docs/spec/consoles.md#设置). Off
-- hides every Passkey entry and refuses every ceremony, but keeps the rows:
-- turning it back on restores the Passkeys Users already added.
ALTER TABLE settings ADD COLUMN passkey_login boolean NOT NULL DEFAULT true;

-- 满足管理员两步验证要求 (docs/spec/authentication.md#两步验证): one
-- definition, every caller. A confirmed TOTP, or — while the instance offers
-- Passkey login — at least one Passkey. With the switch off a Passkey is
-- nothing an admin could sign in with, so it does not satisfy the requirement.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION two_factor_satisfied(uid text) RETURNS boolean
    STABLE LANGUAGE sql AS $$
    SELECT totp_confirmed(uid)
           OR ((SELECT passkey_login FROM settings) AND has_passkey(uid))
$$;
-- +goose StatementEnd
