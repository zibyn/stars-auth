-- +goose Up

-- 满足管理员两步验证要求 (docs/spec/authentication.md#两步验证): one
-- definition, every caller. A confirmed TOTP, or at least one Passkey.
-- +goose StatementBegin
CREATE FUNCTION totp_confirmed(uid text) RETURNS boolean
    STABLE LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM totp_credentials t
                   WHERE t.user_id = uid AND t.confirmed_at IS NOT NULL)
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION has_passkey(uid text) RETURNS boolean
    STABLE LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = uid)
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION two_factor_satisfied(uid text) RETURNS boolean
    STABLE LANGUAGE sql AS $$
    SELECT totp_confirmed(uid) OR has_passkey(uid)
$$;
-- +goose StatementEnd
