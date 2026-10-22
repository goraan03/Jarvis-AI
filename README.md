# Jarvis — Personal AI Agent

A private, single-owner AI agent: real tool use, persistent memory,
Telegram, approvals, scheduling, and (later) browser automation — built
on a data model and API shape that can grow into a multi-user product
later without a rewrite.

Start with `docs/product-requirements.md` and `docs/architecture.md` for
the full design. This README only covers running it locally.

## Status

Phase 6 (memory + scheduler) is complete: the agent can search its own
long-term memory and propose new entries for your review (Memory page);
you can create recurring (cron) or one-off scheduled tasks that fire for
real through BullMQ — survives a worker restart, and a duplicate/near-
simultaneous trigger is a guaranteed no-op, never a double-run. Model
calls still go through `MockProvider` only (see "AI provider" below). No
browser automation or full dashboard polish exist yet — see
`docs/implementation-roadmap.md` for what each later phase adds.

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
npm run dev:worker   # BullMQ worker — runs agent tasks and fires scheduled tasks
```

`npm run dev:worker` must be running for tasks created on the Tasks page
(or via `POST /api/v1/tasks`) to actually execute, and for scheduled
tasks to ever fire — the API only enqueues/registers them.

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

## Telegram

Optional — everything else works without it. To enable:

1. Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`,
   and follow the prompts. You'll get back a token that looks like
   `123456789:AAabcdef...`.
2. Put it in `.env` as `TELEGRAM_BOT_TOKEN`. Restart `npm run dev:worker`
   — it calls Telegram's `getMe` at startup to verify the token actually
   works (not just that it's present) and logs the result.
3. In the web app, go to **Integrations** → **Generate linking code**,
   then either send `/start <code>` to your bot or tap the deep link
   shown. This proves you control that Telegram chat before anything in
   it can talk to your agent.
4. Send the bot anything — it creates a task, replies "⏳ Working on
   it," and follows up with the result once the worker finishes. Use
   `/tasks` to list recent tasks and `/cancel <id>` to cancel one.

Only the linked chat can create tasks or see results; messages from any
other chat (or from a group) get a rejection reply and never touch your
data. `TELEGRAM_WEBHOOK_SECRET` is only needed for a future deployment
with a public webhook — local dev uses long-polling instead.

## Google (Gmail + Calendar)

Optional. To enable:

1. In [Google Cloud Console](https://console.cloud.google.com/), create
   a project, enable the **Gmail API** and **Google Calendar API**, and
   configure the OAuth consent screen in **Testing** mode with your own
   Google account added as a test user (this avoids Google's app
   verification process, which only applies once you go beyond Testing
   mode / 100 test users — not relevant for a single owner).
2. Create an OAuth 2.0 Client ID (Web application) with redirect URI
   `http://localhost:4100/api/v1/integrations/google/callback` (already
   the default in `.env.example`). Put the client ID/secret in `.env` as
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. Make sure `ENCRYPTION_MASTER_KEY` is set (generated during first-time
   setup above) — the refresh token is encrypted with it before storage,
   never kept in plaintext.
4. Restart `npm run dev:worker` and `npm run dev:api`, then go to
   **Integrations** → **Connect Google** in the web app and complete the
   consent screen.

Once connected: `search_emails`, `read_email`, `create_email_draft`, and
`get_calendar_events` work immediately. `send_email` always creates a
pending approval first — check the **Approvals** page (or your linked
Telegram chat, if connected) to approve or reject it before anything is
actually sent.

## Approvals

Any tool classified as requiring approval (currently just `send_email`)
pauses its task instead of running — the task's status becomes
`AWAITING_APPROVAL` and an entry shows up on the **Approvals** page with
the exact parameters it wants to use. Approving or rejecting resumes the
task from exactly where it paused; the approval is bound to those exact
parameters via a hash checked again at execution time, not just trusted
because the status says `APPROVED`.

## Memory

The agent can call `search_memory` any time (read-only, always
available) and `propose_memory` to suggest something worth remembering —
proposals never auto-approve; they land on the **Memory** page for you
to approve, edit, reject, or delete. Turn proposals off entirely by
setting `autoMemoryEnabled: false` via `PATCH /api/v1/settings` — the
`propose_memory` tool simply stops being offered to the model when you
do. Search uses Postgres full-text search and only ever considers
approved memories. Export everything (any status) from the Memory
page's **Export all** button.

## Scheduled tasks

Create a recurring (`cronExpression`, e.g. `0 8 * * *` for daily at
8am) or one-off (`runAt`) task from the **Scheduled** page — each firing
creates a real agent task with the goal you configured (e.g. "Summarize
my calendar for today and any important unread emails" once Google is
connected). Pause/resume/cancel takes effect immediately in the
underlying BullMQ schedule, not just in the database. Scheduling is
backed by Postgres, not just Redis: `apps/worker` re-registers every
active schedule with BullMQ on every boot, so losing Redis or
restarting the worker never loses a recurring job. If you have Telegram
connected, scheduled-task results (success or failure) are also sent to
your linked chat automatically — no separate setup needed.

## Testing

```bash
npm test
```

Runs the full Vitest suite — env-schema validation, secret redaction,
credential encryption, session-token helpers, MockProvider, the tool
registry, the full agent execution loop (multi-step tool chains, limits,
cancellation, retries), approval pause/resume/reject/expiry/tamper-
detection, Gmail MIME encoding + Gmail/Calendar tool gating, Telegram
linking/authorization/idempotency/commands/approval-buttons, memory
search/proposal gating, and scheduler create/pause/resume/cancel/
reconciliation/idempotent-firing (against a fake BullMQ queue — the
restart-survival claim is also verified for real against live Redis;
see the Phase 6 report) — plus API integration tests for auth/
conversations/settings/tasks/integrations/approvals/memories/
scheduled-tasks/webhooks (including cross-user isolation) — against the
`jarvis_test` database, never the dev database.

## Project layout

```
apps/
  web/      React + Vite + TypeScript + Tailwind frontend
  api/      Express REST API — the only process holding secrets/DB access the frontend can reach
  worker/   BullMQ worker — runs the agent task execution loop
packages/
  shared/        Env validation, shared types (grows with each phase)
  database/      Prisma schema + client
  security/      Secret redaction, credential encryption, password/session/approval hashing
  ai-engine/     ModelProvider + MockProvider, tool registry (incl. memory tools), agent execution loop, BullMQ agent-tasks queue
  integrations/  Telegram (client, linking, polling, approval buttons), Google (OAuth, Gmail, Calendar tools)
  scheduler/     Recurring/one-off schedules on BullMQ Job Schedulers, boot-time reconciliation, idempotent firing
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
