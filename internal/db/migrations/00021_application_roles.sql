-- +goose Up

-- Roles an M2M Application holds on its default API (ADR 0015): the Roles its
-- client_credentials token carries, mirroring user_roles. It goes with the
-- Application and with the Role.
CREATE TABLE application_roles (
    client_id text NOT NULL REFERENCES applications (client_id) ON DELETE CASCADE,
    api       text NOT NULL,
    role      text NOT NULL,
    PRIMARY KEY (client_id, api, role),
    FOREIGN KEY (api, role) REFERENCES roles (api, key) ON DELETE CASCADE
);

-- +goose Down

DROP TABLE application_roles;
