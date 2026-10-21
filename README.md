# Jarvis — Personal AI Agent

A private, single-owner AI agent: real tool use, persistent memory,
Telegram, approvals, scheduling, and (later) browser automation — built
on a data model and API shape that can grow into a multi-user product
later without a rewrite.

Start with `docs/product-requirements.md` and `docs/architecture.md` for
the full design. This README only covers running it locally.

## Status

Phase 1 (project foundation) is complete: monorepo scaffold, Postgres +
Redis via Docker Compose, Prisma migrations, a minimal Express API with
health checks, a minimal worker process, a minimal React/Vite/Tailwind
shell, and a baseline test suite. No agent behavior, chat, or
integrations exist yet — see `docs/implementation-roadmap.md` for what
each later phase adds.

## Prerequisites

- Node.js ≥ 20 (developed against v25.2.1)
- npm ≥ 11
- Docker Desktop (for Postgres + Redis via `docker compose`)

## First-time setup

```bash
npm install
cp .env.example .env
# Generate two secrets and paste them into .env:
openssl rand -base64 32   # -> SESSION_SECRET
openssl rand -base64 32   # -> ENCRYPTION_MASTER_KEY
```

Jarvis's Docker services intentionally use non-default ports (`5442` for
Postgres, `6389` for Redis) and the API listens on `4100` — this avoids
colliding with other local projects that use the standard `5432`/`6379`/
`4000`. If `.env.example`'s ports are already in use on your machine,
change them (and the matching value in `docker-compose.yml` /
`apps/web/vite.config.ts`) before continuing.

```bash
docker compose up -d        # starts Postgres + Redis
npm run migrate              # applies Prisma migrations
```

## Running

Each process runs separately (three terminals, or your own process
manager):

```bash
npm run dev:api      # Express API on http://localhost:4100
npm run dev:web      # Vite dev server on http://localhost:5180 (proxies /api to the API)
npm run dev:worker   # background worker (currently idle — connects to Redis and waits; queues land in Phase 3)
```

Verify the API is actually talking to real Postgres and Redis:

```bash
curl http://localhost:4100/api/v1/health
curl http://localhost:4100/api/v1/health/ready
```

`health/ready` returns `{"status":"ready","checks":{"database":"ok","redis":"ok"}}`
when both dependencies are reachable, and `503` with the failing check
named otherwise — it never claims readiness it hasn't verified.

Open http://localhost:5180 — the page shows a live "API status: ok/error"
read from the real `/api/v1/health` endpoint through the Vite proxy, not
a hardcoded value.

## Testing

```bash
npm test
```

Runs the full Vitest suite (currently: env-schema validation, secret
redaction, and API health-endpoint tests) across every workspace.

## Owner bootstrap (lands in Phase 2)

`npm run bootstrap:owner` exists as a script entry but the underlying
logic depends on auth/session code landing in Phase 2. Running it before
then will fail — this is expected, not a bug.

## Project layout

```
apps/
  web/      React + Vite + TypeScript + Tailwind frontend
  api/      Express REST API — the only process holding secrets/DB access the frontend can reach
  worker/   Background job processor (BullMQ consumers land in Phase 3)
packages/
  shared/    Env validation, shared types (grows with each phase)
  database/  Prisma schema + client
  security/  Secret redaction, password hashing (grows with each phase)
docs/        Architecture, data model, API contracts, security model, roadmap, risk register
```

## Troubleshooting

- **Port already in use**: another local Docker project is almost
  certainly using `5432`/`6379`/`4000`/`5173` already. Jarvis is
  configured to avoid those by default (see Prerequisites above); if you
  still hit a conflict, check `docker ps` / `lsof -iTCP:<port> -sTCP:LISTEN`
  and change the Jarvis-side port instead of stopping someone else's
  containers.
- **`health/ready` reports `database: error`**: confirm
  `docker compose ps` shows `jarvis-postgres-1` as `healthy`, and that
  `DATABASE_URL` in `.env` matches the port in `docker-compose.yml`.
- **Prisma migrate can't find `DATABASE_URL`**: `packages/database/prisma.config.ts`
  loads the repo-root `.env` explicitly (Prisma 7 no longer reads
  `datasource.url` from `schema.prisma`) — make sure `.env` exists at the
  repo root, not inside `packages/database/`.
