# Deployment — Jarvis

Status: local-first for v1, finalized Phase 9. Every command below is the
real `package.json` script, copied from the same sequence used to stand
up and verify this repo — not a guess. See `README.md` for the full
walkthrough (including troubleshooting and optional integrations); this
is the condensed reference.

## Local development (target for v1)

Prerequisites: Docker Desktop (Postgres + Redis via `docker compose`),
Node.js ≥ 20, npm ≥ 11.

```bash
npm install
cp .env.example .env
openssl rand -base64 32   # -> SESSION_SECRET in .env
openssl rand -base64 32   # -> ENCRYPTION_MASTER_KEY in .env

docker compose up -d        # starts Postgres (5442) + Redis (6389) only
npm run migrate              # applies Prisma migrations to the dev DB
npm run bootstrap:owner      # one-time: create the single owner account

# Separate test database, migrated once:
docker compose exec postgres psql -U jarvis -d jarvis -c "CREATE DATABASE jarvis_test;"
DATABASE_URL="postgresql://jarvis:jarvis_dev_password@localhost:5442/jarvis_test?schema=public" \
  npm run migrate:deploy -w @jarvis/database
```

Then, each in its own terminal (or process manager):

```bash
npm run dev:api              # Express API — http://localhost:4100
npm run dev:web               # Vite dev server — http://localhost:5180
npm run dev:worker            # BullMQ worker — required for any task to actually run
npm run dev:browser-worker    # optional — only if BROWSER_WORKER_ENABLED=true
```

Verify: `curl http://localhost:4100/api/v1/health/ready` should report
`{"status":"ready",...}` once Postgres/Redis are both reachable.

Full test suite: `npx vitest run` (uses `jarvis_test`, never the dev DB).

## Backup/restore

See `docs/operations.md` "Backups" — real `pg_dump`/`pg_restore`
commands, drilled and verified against this repo's own dev database.

## Future production deployment (not executed now)

Documented here at a high level so Phase 9/10 isn't starting from zero,
not something to act on without explicit owner approval:

- Single Linux VPS, Docker Compose for the whole stack (Postgres, Redis,
  api, worker, web build served via a small static/reverse-proxy
  container), TLS via a reverse proxy (Caddy or nginx + Let's Encrypt).
- Telegram switches from polling to a real webhook once a public HTTPS
  endpoint exists.
- Secrets provided via the VPS's environment (not committed), encryption
  master key rotated to envelope encryption with a managed KMS before
  any multi-user use (security-model.md §4).
- Backup: scheduled `pg_dump` to encrypted off-box storage; restore drill
  documented and actually performed before relying on it (Phase 9 gate).
- This section is explicitly not a go-ahead to provision anything — it's
  here so the later decision has context.
