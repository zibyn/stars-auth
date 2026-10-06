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
