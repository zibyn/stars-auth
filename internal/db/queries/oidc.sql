-- name: Application :one
SELECT * FROM applications WHERE client_id = $1;

-- name: CreateApplication :exec
INSERT INTO applications (client_id, name, type, secret_hash, redirect_uris, post_logout_redirect_uris, default_api)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: SaveGrant :exec
INSERT INTO oidc_grants (id, auth_code_hash, refresh_token_hash, expires_at, sealed)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO UPDATE SET
    auth_code_hash = EXCLUDED.auth_code_hash,
    refresh_token_hash = EXCLUDED.refresh_token_hash,
    expires_at = EXCLUDED.expires_at,
    sealed = EXCLUDED.sealed;

-- name: Grant :one
SELECT * FROM oidc_grants
WHERE id = $1 AND (expires_at IS NULL OR expires_at > now());

-- name: GrantByAuthCodeHash :one
SELECT * FROM oidc_grants
WHERE auth_code_hash = $1 AND (expires_at IS NULL OR expires_at > now());

-- name: GrantByRefreshTokenHash :one
SELECT * FROM oidc_grants
WHERE refresh_token_hash = $1 AND (expires_at IS NULL OR expires_at > now());

-- name: SaveAuthnSession :exec
INSERT INTO oidc_authn_sessions (id, expires_at, data) VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at, data = EXCLUDED.data;

-- name: AuthnSession :one
SELECT data FROM oidc_authn_sessions WHERE id = $1 AND expires_at > now();

-- name: SaveLogoutSession :exec
INSERT INTO oidc_logout_sessions (id, expires_at, data) VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at, data = EXCLUDED.data;

-- name: LogoutSession :one
SELECT data FROM oidc_logout_sessions WHERE id = $1 AND expires_at > now();

-- name: DeleteExpiredOIDC :exec
WITH g AS (DELETE FROM oidc_grants WHERE oidc_grants.expires_at < now()),
     a AS (DELETE FROM oidc_authn_sessions WHERE oidc_authn_sessions.expires_at < now())
DELETE FROM oidc_logout_sessions WHERE oidc_logout_sessions.expires_at < now();

-- name: InsertSigningKey :exec
INSERT INTO signing_keys (kid, sealed) VALUES ($1, $2);

-- name: SigningKeys :many
SELECT kid, sealed FROM signing_keys ORDER BY created_at DESC, kid LIMIT 2;

-- name: DeleteRetiredSigningKeys :exec
DELETE FROM signing_keys WHERE kid NOT IN (
    SELECT kid FROM signing_keys ORDER BY created_at DESC, kid LIMIT 2
);

-- name: LockSigningKeys :exec
SELECT pg_advisory_xact_lock(hashtext('signing_keys'));
