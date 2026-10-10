-- +goose Up

-- M2M Application: 以自己的身份调用 API,只走 client_credentials (ADR 0015).
ALTER TABLE applications
    DROP CONSTRAINT applications_type_check,
    DROP CONSTRAINT applications_check,
    ADD CONSTRAINT applications_type_check CHECK (type IN ('public', 'confidential', 'm2m')),
    -- public 没有 client secret,confidential 与 m2m 都有。
    ADD CONSTRAINT applications_check CHECK ((type <> 'public') = (secret_hash IS NOT NULL));

-- +goose Down

ALTER TABLE applications
    DROP CONSTRAINT applications_type_check,
    DROP CONSTRAINT applications_check,
    ADD CONSTRAINT applications_type_check CHECK (type IN ('public', 'confidential')),
    ADD CONSTRAINT applications_check CHECK ((type = 'confidential') = (secret_hash IS NOT NULL));
