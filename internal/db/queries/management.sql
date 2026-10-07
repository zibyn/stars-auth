-- name: Caller :one
-- Holding any Role on the API makes an admin, even one with no Permissions.
SELECT count(*) > 0 AS admin,
       COALESCE(array_agg(DISTINCT rp.permission ORDER BY rp.permission)
                FILTER (WHERE rp.permission IS NOT NULL), '{}')::text[] AS permissions
FROM user_roles ur LEFT JOIN role_permissions rp USING (api, role)
WHERE ur.user_id = $1 AND ur.api = $2;

-- name: ListUsers :many
-- Search matches part of the sub or of any Identifier. An empty role skips
-- the Role filter.
-- ponytail: strpos scans every row; add a pg_trgm index when the pool is big.
SELECT u.id, u.created_at,
       COALESCE((SELECT json_agg(json_build_object('kind', i.kind, 'value', i.value) ORDER BY i.kind)
                 FROM identifiers i WHERE i.user_id = u.id), '[]')::jsonb AS identifiers,
       COALESCE((SELECT json_agg(json_build_object('api', r.api, 'key', r.key, 'name', r.name) ORDER BY r.api, r.key)
                 FROM user_roles ur JOIN roles r ON r.api = ur.api AND r.key = ur.role
                 WHERE ur.user_id = u.id), '[]')::jsonb AS roles
FROM users u
WHERE (@search::text = ''
       OR strpos(u.id, upper(@search)) > 0
       OR EXISTS (SELECT 1 FROM identifiers i WHERE i.user_id = u.id AND strpos(i.value, lower(@search)) > 0))
  AND (@role::text = ''
       OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.api = @api AND ur.role = @role))
ORDER BY u.created_at DESC, u.id
LIMIT @lim OFFSET @off;

-- name: GetUser :one
SELECT u.id, u.created_at,
       COALESCE((SELECT json_agg(json_build_object('kind', i.kind, 'value', i.value) ORDER BY i.kind)
                 FROM identifiers i WHERE i.user_id = u.id), '[]')::jsonb AS identifiers,
       COALESCE((SELECT json_agg(json_build_object('api', r.api, 'key', r.key, 'name', r.name) ORDER BY r.api, r.key)
                 FROM user_roles ur JOIN roles r ON r.api = ur.api AND r.key = ur.role
                 WHERE ur.user_id = u.id), '[]')::jsonb AS roles,
       EXISTS (SELECT 1 FROM passwords p WHERE p.user_id = u.id) AS has_password
FROM users u
WHERE u.id = $1;

-- name: ListRoles :many
SELECT r.api, a.name AS api_name, r.key, r.name, r.builtin
FROM roles r JOIN apis a ON a.identifier = r.api
ORDER BY a.builtin DESC, r.api, r.builtin DESC, r.key;

-- name: LockOwners :exec
-- Serialises changes that could leave the instance without an owner.
SELECT pg_advisory_xact_lock(hashtext('owners'));

-- name: CountOwners :one
SELECT count(*) FROM user_roles WHERE api = 'urn:stars-auth:management-api' AND role = 'owner';

-- name: SetUserRoles :exec
-- Makes roles a User's Roles on an API; audited with who did it.
WITH gone AS (
    DELETE FROM user_roles
    WHERE user_roles.user_id = @user_id AND user_roles.api = @api AND NOT (user_roles.role = ANY (@roles::text[]))
), added AS (
    INSERT INTO user_roles (user_id, api, role)
    SELECT @user_id, @api, r FROM unnest(@roles::text[]) AS r
    ON CONFLICT DO NOTHING
)
INSERT INTO audit_log (event, sub, detail)
VALUES ('roles.assigned', @user_id::text, jsonb_build_object('api', @api::text, 'roles', @roles::text[], 'by', @by::text));

-- name: ListAPIs :many
-- Every API with its Permissions and Roles; users counts who holds a Role.
SELECT a.identifier, a.name, a.builtin,
       COALESCE((SELECT json_agg(json_build_object('key', p.key, 'name', p.name, 'builtin', p.builtin) ORDER BY p.key)
                 FROM permissions p WHERE p.api = a.identifier), '[]')::jsonb AS permissions,
       COALESCE((SELECT json_agg(json_build_object(
                     'key', r.key, 'name', r.name, 'builtin', r.builtin,
                     'permissions', COALESCE((SELECT json_agg(rp.permission ORDER BY rp.permission) FROM role_permissions rp
                                              WHERE rp.api = r.api AND rp.role = r.key), '[]'),
                     'users', (SELECT count(*) FROM user_roles ur WHERE ur.api = r.api AND ur.role = r.key))
                     ORDER BY r.builtin DESC, r.key)
                 FROM roles r WHERE r.api = a.identifier), '[]')::jsonb AS roles
FROM apis a
ORDER BY a.builtin DESC, a.identifier;

-- name: APIBuiltin :one
SELECT builtin FROM apis WHERE identifier = $1;

-- name: PutAPI :execrows
INSERT INTO apis (identifier, name) VALUES ($1, $2)
ON CONFLICT (identifier) DO UPDATE SET name = EXCLUDED.name WHERE NOT apis.builtin;

-- name: DeleteAPI :execrows
-- Its Permissions, Roles and their assignments go with it, but only when
-- force confirms that; no row while someone holds one of its Roles.
DELETE FROM apis
WHERE apis.identifier = @identifier AND NOT apis.builtin
  AND (@force::boolean OR NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.api = apis.identifier));

-- name: PutPermission :exec
INSERT INTO permissions (api, key, name) VALUES ($1, $2, $3)
ON CONFLICT (api, key) DO UPDATE SET name = EXCLUDED.name;

-- name: DeletePermission :execrows
-- Its Roles lose it too (role_permissions cascades).
DELETE FROM permissions WHERE api = $1 AND key = $2 AND NOT builtin;

-- name: PutRole :execrows
INSERT INTO roles (api, key, name) VALUES ($1, $2, $3)
ON CONFLICT (api, key) DO UPDATE SET name = EXCLUDED.name WHERE NOT roles.builtin;

-- name: SetRolePermissions :exec
WITH gone AS (
    DELETE FROM role_permissions
    WHERE role_permissions.api = @api AND role_permissions.role = @role AND NOT (role_permissions.permission = ANY (@permissions::text[]))
)
INSERT INTO role_permissions (api, role, permission)
SELECT @api, @role, p FROM unnest(@permissions::text[]) AS p
ON CONFLICT DO NOTHING;

-- name: RoleUsers :one
SELECT r.builtin, (SELECT count(*) FROM user_roles ur WHERE ur.api = r.api AND ur.role = r.key) AS users
FROM roles r WHERE r.api = $1 AND r.key = $2;

-- name: DeleteRole :execrows
-- Its assignments go with it (user_roles cascades), but only when force
-- confirms that; no row while someone holds it.
DELETE FROM roles
WHERE roles.api = @api AND roles.key = @key AND NOT roles.builtin
  AND (@force::boolean OR NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.api = roles.api AND ur.role = roles.key));

-- name: ListApplications :many
-- One Application, or all of them for an empty client_id.
SELECT client_id, name, type, builtin, created_at, redirect_uris, post_logout_redirect_uris,
       COALESCE(default_api, '')::text AS default_api,
       COALESCE(extract(epoch FROM session_idle_timeout), 0)::int AS session_idle_timeout,
       refresh_tokens, COALESCE(webhook_url, '')::text AS webhook_url, webhook_secret_updated_at,
       apple_app_ids, android_apps
FROM applications
WHERE @client_id::text = '' OR client_id = @client_id
ORDER BY builtin DESC, created_at, client_id;

-- name: InsertApplication :exec
INSERT INTO applications (client_id, name, type, secret_hash) VALUES ($1, '', $2, $3);

-- name: UpdateApplication :execrows
-- An empty webhook_url turns the webhook off; a NULL webhook_secret keeps
-- the stored one. idle_secs 0 means the default Session lifetime.
UPDATE applications SET
    name = @name,
    redirect_uris = @redirect_uris,
    post_logout_redirect_uris = @post_logout_redirect_uris,
    default_api = NULLIF(@default_api::text, ''),
    session_idle_timeout = NULLIF(@idle_secs::int, 0) * interval '1 second',
    refresh_tokens = @refresh_tokens,
    webhook_url = NULLIF(@webhook_url::text, ''),
    webhook_secret = CASE WHEN @webhook_url = '' THEN NULL ELSE COALESCE(sqlc.narg(webhook_secret), webhook_secret) END,
    webhook_secret_updated_at = CASE WHEN @webhook_url = '' THEN NULL
                                     WHEN sqlc.narg(webhook_secret) IS NOT NULL THEN now()
                                     ELSE webhook_secret_updated_at END,
    apple_app_ids = @apple_app_ids,
    android_apps = @android_apps
WHERE client_id = @client_id AND NOT builtin;

-- name: SetApplicationSecret :execrows
UPDATE applications SET secret_hash = $2 WHERE client_id = $1 AND type = 'confidential' AND NOT builtin;

-- name: DeleteApplication :exec
DELETE FROM applications WHERE client_id = $1 AND NOT builtin;
