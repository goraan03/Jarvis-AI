# Jarvis — Personal AI Agent

A private, single-owner AI agent: real tool use, persistent memory,
Telegram, approvals, scheduling, and (later) browser automation — built
on a data model and API shape that can grow into a multi-user product
later without a rewrite.

Start with `docs/product-requirements.md` and `docs/architecture.md` for
the full design. This README only covers running it locally.

## Status

Phase 3 (agent engine and tools) is complete: a real multi-step task
execution loop running on a BullMQ worker, a tool registry
(`get_current_time` always available; `search_web` only if
`BRAVE_SEARCH_API_KEY` is set), and a Tasks page to run/watch/cancel
tasks. Model calls still go through `MockProvider` only (see "AI
provider" below). No memory, integrations, approvals, or scheduling
exist yet — see `docs/implementation-roadmap.md` for what each later
phase adds.

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
npm run migrate              # applies Prisma migrations to the dev database

# One-time: create the owner account (reads BOOTSTRAP_OWNER_EMAIL/PASSWORD
# from the environment if set, otherwise prompts interactively)
npm run bootstrap:owner
```

Tests run against a separate `jarvis_test` database so `npm test` never
touches your real conversations. Create it once and apply migrations to it:

```bash
docker compose exec postgres psql -U jarvis -d jarvis -c "CREATE DATABASE jarvis_test;"
DATABASE_URL="postgresql://jarvis:jarvis_dev_password@localhost:5442/jarvis_test?schema=public" \
  npm run migrate:deploy -w @jarvis/database
```

## Running

Each process runs separately (three terminals, or your own process
manager):

```bash
npm run dev:api      # Express API on http://localhost:4100
npm run dev:web      # Vite dev server on http://localhost:5180 (proxies /api to the API)
npm run dev:worker   # BullMQ worker — runs agent tasks from the agent-tasks queue
```

`npm run dev:worker` must be running for tasks created on the Tasks page
(or via `POST /api/v1/tasks`) to actually execute — the API only
enqueues them.

Verify the API is actually talking to real Postgres and Redis:

```bash
curl http://localhost:4100/api/v1/health
curl http://localhost:4100/api/v1/health/ready
```

`health/ready` returns `{"status":"ready","checks":{"database":"ok","redis":"ok"}}`
when both dependencies are reachable, and `503` with the failing check
named otherwise — it never claims readiness it hasn't verified.

Open http://localhost:5180 and sign in with the email/password you set
during `npm run bootstrap:owner` — you'll land on the chat page, where
messages get a real (mock) reply and persist across reloads/restarts.

## AI provider

`AI_PROVIDER` in `.env` controls which model backend the chat route uses.
It defaults to `mock`, which returns a deterministic, clearly-labeled
placeholder reply (`providerUsed: "mock"` on the message, tagged in
`UsageRecord.provider` too) — no network call, no cost, safe to leave on
indefinitely. `AI_PROVIDER=anthropic` is intentionally not implemented
yet; the app will fail fast with a clear error rather than silently
running mock responses under a real-provider label. Say when you want
real Claude API calls and the Anthropic provider gets added then.

## Tools

The agent can only use tools that are both implemented and configured.
`get_current_time` needs nothing and is always available. `search_web`
calls the real Brave Search API and is only registered at all when
`BRAVE_SEARCH_API_KEY` is set in `.env` — without it, the agent simply
never sees a `search_web` tool (no fake/placeholder tool is offered).

## Testing

```bash
npm test
```

Runs the full Vitest suite — env-schema validation, secret redaction,
session-token helpers, MockProvider, the tool registry, the full agent
execution loop (multi-step tool chains, limits, cancellation, retries),
and API integration tests for auth/conversations/settings/tasks
(including cross-user isolation) — against the `jarvis_test` database,
never the dev database.

## Project layout

```
apps/
  web/      React + Vite + TypeScript + Tailwind frontend
  api/      Express REST API — the only process holding secrets/DB access the frontend can reach
  worker/   BullMQ worker — runs the agent task execution loop
packages/
  shared/     Env validation, shared types (grows with each phase)
  database/   Prisma schema + client
  security/   Secret redaction, password/session-token hashing
  ai-engine/  ModelProvider + MockProvider, tool registry, agent execution loop, BullMQ queue
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
