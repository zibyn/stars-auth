# Stars Auth



## Development

Go 1.27, Node 24, pnpm 12, Docker.

```bash
docker compose up -d postgres                    # or any PostgreSQL 15+
cd web && pnpm install && pnpm dev               # Vite on :3000
STARS_AUTH_DATABASE_URL=postgres://... \
STARS_AUTH_MASTER_KEY=$(openssl rand -base64 32) \
STARS_AUTH_ISSUER=https://localhost \
STARS_AUTH_DEV_WEB_URL=http://localhost:3000 \
  go run ./cmd/stars-auth                        # browse http://localhost:8080
```

Without `STARS_AUTH_DEV_WEB_URL` the binary serves the SPA embedded from
`web/dist/client`, so run `pnpm build` before `go build`.

Tests needing PostgreSQL run when `STARS_AUTH_TEST_DATABASE_URL` is set
(e.g. `postgres://postgres:pg@localhost:5432/postgres`); they create their own
databases.

Full deployment: `compose.yaml` (Stars Auth + PostgreSQL + Caddy).
