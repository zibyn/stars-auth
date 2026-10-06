-- name: PoWSecret :one
SELECT pow_secret FROM settings;

-- name: SpendPoW :execrows
INSERT INTO pow_spent (signature, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteExpiredPoW :exec
DELETE FROM pow_spent WHERE expires_at < now();
