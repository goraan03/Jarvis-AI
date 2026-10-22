# Implementation Roadmap — Jarvis

Status: Phase 0. Phases are sequential; each ends with a report (see
format at the bottom) before the next begins. Acceptance criteria below
are the actual gate — a phase isn't "done" because code was written, it's
done when its criteria are demonstrably true.

## Phase 1 — Project foundation
Scaffold the monorepo (`apps/web|api|worker`, `packages/shared|database|
security` minimally), Docker Compose for Postgres+Redis, Prisma with the
Phase 1–2 models from `database-design.md`, env validation (zod-parsed
env at boot, fail fast with a clear message if required vars are
missing), `/api/v1/health` and `/api/v1/health/ready`, structured logging
(`pino`), a minimal Vite+React+Tailwind shell, baseline Vitest setup, and
a README with real setup steps.
**Gate:** `docker compose up`, migrations run, both health endpoints
return 200, `npm test` passes, nothing in git has a real secret.

## Phase 2 — Private user and chat
Owner bootstrap CLI, session auth, `AgentSettings`, `Conversation`/
`Message` persistence, `ModelProvider` interface with `AnthropicProvider`
+ `MockProvider`, basic chat UI (send message → see persisted reply),
`UsageRecord` writes, graceful handling of model API errors (timeout,
rate limit, auth failure) surfaced as real UI state, not swallowed.
**Gate:** owner logs in; conversation survives an `apps/api` restart; a
real Anthropic request succeeds *if and only if* a billed API key is
configured (see architecture.md §6 open question) — otherwise the UI
clearly states the provider is unconfigured, it does not pretend to
answer; credentials never appear in any frontend network request/response
body; auth + ownership tests pass.

## Phase 3 — Agent engine and tools
Tool registry + schemas, permission policy wiring, `Task`/`TaskStep`/
`ToolExecution` models, the execution loop (architecture.md §4), worker
process consuming an `agent-tasks` BullMQ queue, execution limits +
cancellation + retries, a harmless local test tool (e.g. `get_current_time`
or similar) plus `search_web` (registered only if a provider key is
configured).
**Gate:** a real multi-step task (model calls a tool, gets a result, calls
another tool, answers) runs end to end against `MockProvider` in tests and
against the real provider manually if configured; an invalid tool input
is rejected before the handler runs; a task that exceeds a configured
limit fails with a clear `failureReason`, never hangs; cancellation
actually stops further tool calls; nothing is reported "completed"
without a persisted `ToolExecution` backing it.

## Phase 4 — Telegram
Bot registration instructions, account-linking flow (owner proves
identity once, e.g. via a one-time code shown in the web UI and sent to
the bot), webhook endpoint with secret-token verification and `update_id`
dedup, task creation/status/cancel from Telegram, progress + final-report
messages, approval approve/reject via Telegram callback buttons.
**Gate:** only the linked Telegram account can create tasks or see
results; a duplicate webhook delivery (simulated) does not double-create
a task or double-send a message; `apps/api` logs show the dedup actually
triggered in that test.

## Phase 5 — Approvals and first real integrations
`ApprovalRequest` model + API + minimal UI + Telegram approval already
wired in Phase 4 gets tied to real actions now; Gmail OAuth (search,
read, create draft — send gated behind approval); Google Calendar OAuth
(read only this phase).
**Gate:** reading/searching real Gmail data works with a configured
account; draft creation works; attempting to send without an approved
`ApprovalRequest` is rejected by backend code (tested by trying to call
the handler directly, bypassing the UI); changing the email body after
approval invalidates the approval (inputHash mismatch test).

## Phase 6 — Memory and scheduler
`Memory` model + Postgres FTS search + proposal/approve/reject/edit/
delete/export flows; `propose_memory`/`search_memory` tools;
`ScheduledTask` model, BullMQ repeatable jobs + Postgres reconciliation on
worker boot, pause/resume/edit/cancel, failure notification (via
Telegram), a "morning briefing" scheduled workflow as the first real
recurring task.
**Gate:** restart `apps/worker` mid-schedule and confirm the next
occurrence still fires at the right time; two manual triggers of the same
scheduled job close together don't produce duplicate side effects
(idempotency key test); memory export produces a complete, user-readable
file; deleting a memory removes it from search immediately.

## Phase 7 — Google Drive and advanced research
Drive OAuth (read-only), `search_drive_files`/`read_drive_file` tools,
multi-source research flow that cites which result came from which tool
call, persisted research reports.
**Gate:** a research task's final report links back to real
`ToolExecution` rows for every cited source; the report text is visibly
distinct from "things the model asserted without a backing tool call."

## Phase 8 — Isolated browser agent
`browser-worker` process, Playwright, navigation/extraction/form-fill/
download tools behind the same registry+permission+approval machinery,
SSRF/egress blocklist (security-model.md §7), per-task resource limits,
session isolation, full action logging.
**Gate:** a request to navigate to `http://169.254.169.254/` or a private
RFC1918 address is blocked and logged, verified by an automated test, not
just code review; a browser task that runs past its timeout is actually
killed (process-level, not just "the promise resolves eventually").

## Phase 9 — Dashboard and reliability
Finish all UI pages listed in the spec (dashboard, chat, task detail,
integrations, memory, scheduled tasks, approvals, activity log, usage/
costs, settings) wired to real endpoints; backup/restore procedure for
Postgres (documented and actually executed once as a drill); basic
uptime/error monitoring; security test suite consolidated and run;
deployment documentation finalized.
**Gate:** every dashboard number traces to a real query, none hardcoded;
a backup taken and restored into a fresh database reproduces the data;
known limitations are written down, not implied.

## Phase 10 — Future commercial preparation (docs only)
Written analysis (no code) of what changes for multi-tenancy: public
registration + verification + password reset, orgs/workspaces,
tenant isolation beyond `userId` (evaluate row-level security), plans/
quotas/metering, billing integration, admin tooling, data export/
deletion compliance, production monitoring/support processes. Explicitly
states that the Phase 1–9 product is not production-ready for multiple
paying customers and enumerates exactly why.
**Delivered:** `docs/commercial-readiness.md` — grounded in the actual
Phase 1–9 codebase (file:line citations throughout, not assumptions),
with a 10-point verdict on why v1 isn't commercial-ready yet, a
per-topic current-state/what's-needed breakdown for all eight required
areas, and a row-level-security recommendation (adopt once
Organizations exist, keyed on `orgId` not `userId`).

## End-of-phase report format
Every phase ends with: implemented functionality; files created/modified;
database migrations added; commands actually executed (with real
output, not assumed); tests run and their actual pass/fail result;
configuration still required from the owner; known limitations;
recommended next step. No phase is marked done with unexecuted tests or
unexplored TODOs standing in for real functionality.
