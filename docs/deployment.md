# Deployment — Jarvis

Status: Phase 0 skeleton. Local-first for v1; this doc grows real
commands as each phase lands, and gets a "production" section only when
the owner actually asks to deploy beyond a laptop.

## Local development (target for v1)

- Prerequisites: Docker Desktop (Postgres + Redis via `docker compose`),
  Node.js ≥ 20 (local machine has v25.2.1), npm 11.
- `docker compose up -d` — starts Postgres and Redis only; `apps/*`
  run directly via `npm run dev` from the host for fast iteration.
- `.env` from `.env.example`, filled with local values; `DATABASE_URL`
  and `REDIS_URL` point at the Compose services; `ENCRYPTION_MASTER_KEY`
  generated once via `openssl rand -base64 32` and kept out of git.
- `npm run migrate` (Prisma) against the local database.
- `npm run bootstrap --workspace apps/api` to create the owner account.
- `npm run dev` (root script fanning out to `apps/web` and `apps/api`;
  `apps/worker` started separately once it exists, Phase 3+).

Full command list and troubleshooting are finalized in Phase 1 once the
actual `package.json` scripts exist — this section will be replaced with
the real, tested commands rather than guesses.

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
