-- +goose Up

-- The enabled Channel for each Identifier kind; no row, no codes of that kind.
CREATE TABLE channels (
    kind       text PRIMARY KEY CHECK (kind IN ('phone', 'email')),
    plugin     text NOT NULL,
    -- Settings that are not secret, as the plugin's fields name them.
    config     jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Secret settings, sealed with the master key (aad "channel:<kind>:<plugin>:<field>").
CREATE TABLE channel_secrets (
    kind       text NOT NULL REFERENCES channels (kind) ON DELETE CASCADE,
    field      text NOT NULL,
    value      bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, field)
);
