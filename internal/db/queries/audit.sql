-- name: Audit :exec
INSERT INTO audit_log (event, sub, detail) VALUES ($1, $2, $3);

-- name: AuditedSince :one
SELECT EXISTS (SELECT 1 FROM audit_log WHERE event = $1 AND at > $2);
