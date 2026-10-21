# API Contracts — Jarvis (Phase 0 draft)

REST over JSON, Express, all routes under `/api/v1`. Every route except
`/api/v1/auth/login` and `/api/v1/health` requires a valid session cookie.
Every handler validates its input with a `zod` schema shared from
`packages/shared` (so the frontend and tests can import the same schema)
and returns errors in a consistent envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

Success responses are the resource itself (or `{ "data": [...] }` for
collections with `{ "page", "pageSize", "total" }` pagination metadata).

This is a contract sketch to pin down shape before implementation; routes
are added as their phase lands, not all at once.

## Auth (Phase 2)

- `POST /api/v1/auth/login` — `{ email, password }` → sets session cookie.
- `POST /api/v1/auth/logout` — clears session.
- `GET /api/v1/auth/me` — current user (no password hash, ever).

No `POST /api/v1/auth/register` in v1 — owner account is created by the
bootstrap script (`docs/security-model.md` §2), not an HTTP endpoint.

## Conversations & chat (Phase 2)

- `GET /api/v1/conversations` — list, paginated.
- `POST /api/v1/conversations` — create.
- `GET /api/v1/conversations/:id` — with messages.
- `POST /api/v1/conversations/:id/messages` — `{ content }` → persists the
  user message, enqueues agent processing, returns the persisted user
  message immediately (the assistant's reply arrives via polling/task
  status, not synchronously in this response).

## Tasks (Phase 3)

- `GET /api/v1/tasks` — list, filterable by status.
- `GET /api/v1/tasks/:id` — full detail: steps, tool executions, status.
- `POST /api/v1/tasks/:id/cancel` — requests cancellation; actual stop
  happens at the next safe checkpoint in the worker loop.

## Approvals (Phase 5)

- `GET /api/v1/approvals?status=pending` — queue.
- `GET /api/v1/approvals/:id` — detail, including `boundInput` shown
  verbatim so the owner approves the *exact* action.
- `POST /api/v1/approvals/:id/approve`
- `POST /api/v1/approvals/:id/reject`

Approving re-validates `inputHash` against the live tool-call input before
the worker proceeds — if anything changed between request and decision,
execution is blocked and a new approval is required.

## Integrations (Phase 4–7)

- `GET /api/v1/integrations` — status per provider (connected,
  disconnected, error, needs_reauth) — never returns token values.
- `DELETE /api/v1/integrations/:provider` — disconnect + revoke where the
  provider supports remote revocation.

Telegram doesn't use OAuth (there's no per-user secret to exchange — the
bot token is a single server-side secret, not a per-connection
credential), so it gets its own linking endpoint instead of `connect`/
`callback` (implemented Phase 4):

- `POST /api/v1/integrations/telegram/link-code` — issues a short-lived,
  single-use code (`{ code, expiresAt, deepLink }`); `deepLink` is `null`
  if no bot username is configured yet. The owner sends `/start <code>`
  to the bot (or taps the deep link) to bind their chat.

OAuth-based providers (Gmail, Calendar, Drive, GitHub — Phase 5+) use the
originally documented shape:

- `POST /api/v1/integrations/:provider/connect` — starts OAuth flow (302
  to provider).
- `GET /api/v1/integrations/:provider/callback` — OAuth redirect target;
  validates `state`, exchanges code, encrypts and stores credential.

## Memory (Phase 6)

- `GET /api/v1/memories?status=approved&q=...` — search (Postgres FTS).
- `GET /api/v1/memories?status=proposed` — review queue.
- `PATCH /api/v1/memories/:id` — edit content/category, or change status
  (approve/reject/archive).
- `DELETE /api/v1/memories/:id`
- `GET /api/v1/memories/export` — full export (JSON) for the owner.

## Scheduled tasks (Phase 6)

- `GET /api/v1/scheduled-tasks`
- `POST /api/v1/scheduled-tasks` — `{ name, cronExpression | runAt,
  timezone, payload }`
- `PATCH /api/v1/scheduled-tasks/:id` — edit or pause/resume
  (`{ status }`)
- `DELETE /api/v1/scheduled-tasks/:id`
- `GET /api/v1/scheduled-tasks/:id/runs` — execution history

## Usage & settings (Phase 2 / 9)

- `GET /api/v1/usage?from=&to=` — token/cost rollups.
- `GET /api/v1/settings`, `PATCH /api/v1/settings` — `AgentSettings`.

## Audit (Phase 9)

- `GET /api/v1/audit-log?from=&to=&action=` — paginated, read-only.

## Health & ops

- `GET /api/v1/health` — process liveness, no auth required, no secrets.
- `GET /api/v1/health/ready` — checks DB + Redis connectivity.

## Webhooks (external → us)

- `POST /webhooks/telegram` — Telegram update webhook (Phase 4). Verifies
  the secret token Telegram sends in
  `X-Telegram-Bot-Api-Secret-Token` before processing; deduplicates by
  Telegram `update_id` (stored, checked, idempotent). Implemented but
  inactive in local dev — there's no public HTTPS endpoint to register
  with Telegram, so `apps/worker` long-polls instead, sharing the exact
  same `processUpdate` handler. Only mounted at all when a Telegram bot
  token is configured.
- `POST /webhooks/google/:provider` — reserved for push notifications if
  used later; not implemented in v1 (polling/on-demand is sufficient for
  Gmail/Calendar/Drive at single-user scale).

## Versioning

`/api/v1` from day one so a breaking v2 can be introduced later (relevant
for Phase 10 multi-tenant changes) without an immediate migration
scramble.
