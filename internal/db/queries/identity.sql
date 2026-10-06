-- name: LockSetup :one
SELECT setup_token, setup_done FROM settings FOR UPDATE;

-- name: SetSetupToken :exec
UPDATE settings SET setup_token = $1;

-- name: CloseSetup :exec
UPDATE settings SET setup_token = NULL, setup_done = true;

-- name: CreateUser :exec
INSERT INTO users (id) VALUES ($1);

-- name: AddIdentifier :exec
INSERT INTO identifiers (user_id, kind, value) VALUES ($1, $2, $3);

-- name: SetPassword :exec
INSERT INTO passwords (user_id, hash) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash;

-- name: AssignRole :exec
INSERT INTO user_roles (user_id, api, role) VALUES ($1, $2, $3);

-- name: PasswordByIdentifier :one
SELECT i.user_id, p.hash,
       EXISTS (SELECT 1 FROM user_roles r
               WHERE r.user_id = i.user_id AND r.api = 'urn:stars-auth:management-api') AS admin
FROM identifiers i JOIN passwords p USING (user_id)
WHERE i.value = $1;

-- name: PasswordLogin :one
SELECT password_login FROM settings;

-- name: CreateSession :exec
INSERT INTO sessions (id_hash, user_id, auth_time, amr) VALUES ($1, $2, $3, $4);

-- name: TouchSession :one
UPDATE sessions SET last_seen_at = now()
WHERE id_hash = $1 AND last_seen_at > @idle_since
RETURNING user_id, auth_time, amr;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id_hash = $1;

-- name: DeleteIdleSessions :exec
DELETE FROM sessions WHERE last_seen_at < @idle_since;
