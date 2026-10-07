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

## First start

Until an admin exists, every start logs the setup link:

```bash
docker compose logs stars-auth | grep setup
# WARN no admin yet: open the setup page to create the owner url="https://localhost/setup?token=..."
```

Open it and set the owner's username and password; the page then closes for
good. The owner signs in to the admin console at `/console`.

The Management API lives under `/v1/management`; its OpenAPI document is at
`/v1/management/openapi.json`. Apps sign in without a browser through the
direct auth API at `/v1/auth/challenge`, documented at `/v1/auth/openapi.json`.

To try the OIDC flow before the console can register Applications, add a
public test client by hand and run a code + PKCE flow against it:

```bash
docker compose exec postgres psql -U stars -c "INSERT INTO applications (client_id, name, type, redirect_uris)
  VALUES ('test-rp', 'Test RP', 'public', '{https://rp.example/cb}')"
```
