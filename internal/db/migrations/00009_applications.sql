-- +goose Up

-- Application settings the console edits (docs/spec/consoles.md).
ALTER TABLE applications
    -- user.deleted webhook (docs/spec/protocol.md#webhook); the signing key is
    -- sealed with the master key (aad "application:<client_id>:webhook").
    ADD COLUMN webhook_url text,
    ADD COLUMN webhook_secret bytea,
    ADD COLUMN webhook_secret_updated_at timestamptz,
    ADD CONSTRAINT applications_webhook_check CHECK ((webhook_url IS NULL) = (webhook_secret IS NULL)),
    -- App association: Team ID + Bundle ID ("ABCDE12345.com.example.app"),
    -- and [{"packageName", "sha256CertFingerprints"}] for Android.
    ADD COLUMN apple_app_ids text[] NOT NULL DEFAULT '{}',
    ADD COLUMN android_apps jsonb NOT NULL DEFAULT '[]';
