# Architecture — Jarvis Personal AI Agent

Status: Phase 0 proposal. Revisit at the start of each phase.

## 1. Shape: modular monolith + workers

```
apps/
  web/              React + Vite + TS + Tailwind SPA
  api/               Express + TS REST API (the only thing the frontend talks to)
  worker/            BullMQ worker(s): agent task execution, scheduled jobs,
                      integration sync, notification delivery
  browser-worker/    Playwright, isolated process, introduced in Phase 8

packages/
  shared/            Cross-cutting TS types, zod schemas, constants used by
                      both api and web (and workers)
  database/          Prisma schema, migrations, generated client, seed script
  ai-engine/         Model-provider abstraction, agent loop, tool registry,
                      structured-output validation
  integrations/       One subpackage per external service (telegram, gmail,
                      google-calendar, google-drive, github, web-search),
                      each behind a common interface
  memory/             Memory CRUD, search, proposal/approval flow
  scheduler/           BullMQ job definitions + Postgres-backed schedule
                      metadata, idempotency helpers
  approvals/           Approval request lifecycle, binding/validation logic
  security/           Credential encryption, secret redaction, permission
                      policy evaluation shared by api and worker

docs/                 This documentation set (living, updated every phase)
```

Why a modular monolith and not microservices: one user, one deployment
target (a laptop, later a single VPS), and the spec explicitly asks for
this. `packages/*` gives each concern a clean boundary (own `package.json`,
own tests, own public interface) without the operational cost of separate
deployables. The two things that *do* run as separate processes —
`worker` and `browser-worker` — do so because they are long-running /
resource-isolated by nature (queue consumers, headless browser), not
because of a service-oriented philosophy.

## 2. Monorepo tooling

npm workspaces (built into the already-installed npm 11, zero extra
dependency) with workspaces `apps/*` and `packages/*`. No Turborepo/Nx/pnpm
at this stage — nothing in v1 needs a remote build cache or selective
task graph; add one later only if build times demonstrably justify it.

TypeScript project references tie the packages together so `apps/api` gets
real types from `packages/database`, `packages/ai-engine`, etc. without a
publish step.

## 3. Request flow (web UI)

```
Browser (apps/web)
  → HTTPS/JSON → apps/api (Express)
       → auth/session middleware (cookie session, backed by Session table)
       → zod-validated route handlers
       → packages/* (business logic, Prisma access)
       → enqueues BullMQ job for anything agent/tool related
  ← JSON response (immediate ack: "task created", not the task result)

apps/web polls or (later) subscribes to task/message updates via
short-interval polling in v1 (simplest, no extra infra); revisit SSE/WS
only if polling latency becomes a real UX problem.

apps/worker (BullMQ consumer)
  → packages/ai-engine agent loop
       → packages/security permission check (independent of the prompt)
       → packages/integrations / packages/memory / packages/scheduler tool
         handlers
       → packages/approvals gate for consequential actions
  → writes TaskStep / ToolExecution / Message / AuditLog rows
  → apps/api reads this same Postgres state to answer the browser/Telegram
```

The frontend and Telegram bot never call the model directly and never hold
API keys — they only ever talk to `apps/api`, which is the single place
that holds secrets and the single place that authorizes actions.

## 4. Agent engine (`packages/ai-engine`)

Task state machine: `pending → planning → running → awaiting_approval →
completed | failed | cancelled`. Persisted in Postgres (`Task`,
`TaskStep`, `ToolExecution`) — the worker process is stateless between
restarts; it reloads state from the DB.

Execution loop per task (implements lifecycle from spec §6):

1. Load task + conversation context + relevant memory.
2. Call the model with the tool registry's schemas attached (one "turn").
3. Model either answers directly or requests tool call(s).
4. For each requested tool call: validate input against the tool's zod
   schema → check `packages/security` permission policy → if the tool is
   classified as requiring approval, create an `ApprovalRequest` bound to
   the exact tool name + input and pause the task
   (`awaiting_approval`) → otherwise execute the handler.
5. Tool handler executes against the real integration/service; its return
   value is validated against the tool's output schema; the raw result is
   persisted as a `ToolExecution` row (never trusted/paraphrased by the
   model as "done").
6. Result is fed back to the model as a tool result message; loop to (2)
   until the model produces a final answer or a limit is hit.
7. Limits enforced by the engine, not the prompt: wall-clock duration, tool
   call count, model call count, retries per tool call, token usage,
   estimated cost, concurrent tasks per user. Exceeding any limit fails the
   task with a clear reason, it does not silently stop.
8. Final report assembled from verified `ToolExecution`/`TaskStep` rows,
   not from the model's own narration of what it did.

The engine never surfaces hidden chain-of-thought; it stores/display a
short plan, the sequence of tool calls with their real inputs/outputs, and
the final answer.

## 5. Tool registry (`packages/ai-engine/tools`)

Each tool is a plain object: `{ name, description, inputSchema (zod),
outputSchema (zod), requiredPermissions[], riskLevel: 'low'|'medium'|'high',
timeoutMs, requiresApproval: boolean, handler(input, ctx) }`. The registry
is populated at boot only from tools whose dependencies are actually
configured (e.g. `search_emails` is absent entirely if Gmail isn't
connected) — the model only ever sees tools that can really execute.
`ctx` carries the authenticated `userId`, never anything the model can
forge.

## 6. Model provider (`packages/ai-engine/providers`)

```ts
interface ModelProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>; // supports
  // tool-call turns, structured output, usage reporting
}
```

- `AnthropicProvider` — wraps `@anthropic-ai/sdk`, model id configurable
  via env (default a current Claude model, e.g. `claude-sonnet-5`), implements
  timeout, retry-with-backoff on 429/5xx, and maps usage (`input_tokens`,
  `output_tokens`) to a `UsageRecord` with cost computed from a configurable
  price table (so pricing changes don't require code changes).
- `MockProvider` — deterministic canned/templated responses for local dev
  and tests. Every mock response is tagged (`provider: 'mock'`) end-to-end
  into `UsageRecord` and the UI, so a mock run can never be mistaken for a
  real model execution.

**Open question requiring owner input before Phase 2**: Anthropic API
access for server-side calls requires **API billing** (console.anthropic.com,
pay-as-you-go or prepaid credits). This is a *different* account/credential
from a Claude.ai or Claude Code consumer subscription — having Claude Code
installed does **not** grant API credits. The owner needs to confirm an API
key exists (or create one) before Phase 2's "send a real request to the
model" acceptance criterion can be met. Development and most of Phase 1–3's
plumbing can proceed against `MockProvider` regardless.

## 7. Database

PostgreSQL + Prisma, versioned migrations (`prisma migrate dev` locally,
`prisma migrate deploy` in CI/prod). See `docs/database-design.md` for the
schema. Every user-owned table has a non-nullable `userId` foreign key —
no implicit single-user shortcuts, so Phase 10 can add row-level
multi-tenancy checks without a schema rewrite.

## 8. Background processing

Redis + BullMQ. Queues (initial set, grown as phases land):
`agent-tasks`, `scheduled-jobs`, `notifications`, `integration-sync`.
Scheduled/recurring jobs use BullMQ's repeatable jobs keyed by the
`ScheduledTask.id` so edits/cancellations are idempotent; a periodic
reconciliation job on worker boot re-registers repeatables from Postgres so
Redis is never the sole source of truth for "what should be scheduled."

## 9. Multi-user readiness (built now, not activated now)

Done now, costs nothing extra:
- `userId` foreign key everywhere.
- Session/auth layer already modeled as "a user can have N sessions," not
  a singleton.
- Tool permission checks keyed by `userId`, not a global flag.
- `AgentSettings` row scoped per user (limits, cost caps, provider config
  overrides) rather than process-wide env-only config.

Deliberately deferred to Phase 10 (documented, not built):
- Public registration + email verification + password reset.
- Organizations/workspaces and membership roles.
- Tenant isolation beyond `userId` (e.g. row-level security, per-tenant
  encryption keys).
- Plans, quotas, metering, billing integration (Stripe or similar).
- Admin portal, impersonation-for-support tooling, data export/deletion
  compliance flows at scale.

## 10. Security boundaries (summary — full detail in security-model.md)

- The model is a *requester*, never an *authorizer*. Every tool call is
  re-checked against stored permissions/approvals in `apps/api`/`worker`
  code, independent of anything the model said.
- Secrets (Anthropic key, OAuth client secrets, Telegram bot token,
  encryption master key) live only in `apps/api`/`apps/worker` process env;
  never sent to `apps/web`, never logged (redaction in `packages/security`).
- OAuth tokens and other stored credentials are encrypted at rest
  (AES-256-GCM, key from `ENCRYPTION_MASTER_KEY`), one `EncryptedCredential`
  row per integration connection, with a `keyVersion` column to support
  future key rotation.

## 11. Dependency list (initial, v1)

Runtime:
- `express`, `zod` (+ `@anthropic-ai/sdk` in `ai-engine`), `prisma` /
  `@prisma/client`, `bullmq`, `ioredis`, `argon2` (password hashing),
  `cookie-session` or `express-session` + `connect-pg-simple` (session
  store in Postgres — avoids a second stateful dependency), `helmet`,
  `express-rate-limit`, `pino` (structured logging), `dotenv`, `playwright`
  (Phase 8 only, isolated worker package).
- Integrations: `node-telegram-bot-api` or Telegram Bot API via raw
  `fetch` (decide in Phase 4 — raw fetch avoids an extra dependency and
  Telegram's HTTP API is simple enough; default to no library unless
  webhook/polling ergonomics argue otherwise), `googleapis` (Gmail/
  Calendar/Drive), `@octokit/rest` (GitHub, Phase 6+).
- Web search provider: abstraction defined now, concrete provider chosen
  before Phase 3 needs it — see open question below.

Frontend: `react`, `react-dom`, `vite`, `typescript`, `tailwindcss`,
`@tanstack/react-query` (server-state fetching/polling — avoids hand-rolled
polling/caching code), `react-router`.

Dev/test: `vitest`, `supertest` (API integration tests against the Express
app), `@playwright/test` (e2e, Phase 8+), `eslint`, `prettier`,
`typescript-eslint`.

Deliberately not included unless a later phase demonstrates need: ORM
alternatives, GraphQL, a message broker beyond Redis/BullMQ, a vector DB,
a frontend state-management library beyond React Query + local state,
Turborepo/Nx.

**Open question requiring owner input**: which web search API to use for
the `search_web` tool (Phase 3). Candidates: Brave Search API, Tavily,
Exa, SerpAPI — all require a separate signup/API key. Recommend Brave
Search API (official API, reasonable free tier, no scraping ToS risk) but
this is the owner's call and needed before Phase 3's web-search tool can
be exercised for real (Phase 3 can still ship with the tool
registered-but-unconfigured against `MockProvider`-backed tests).

## 12. What Phase 0 deliberately does not decide yet

- Exact Telegram library choice (fetch vs. SDK) — Phase 4.
- Exact session cookie library — Phase 2, small decision, low risk either
  way.
- Production deployment target specifics (VPS provider, TLS, process
  manager) — documented at a high level in `docs/deployment.md`, finalized
  only when the owner asks to deploy.
