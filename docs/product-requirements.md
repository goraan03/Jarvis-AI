# Product Requirements — Jarvis Personal AI Agent

Status: Phase 0 draft. Living document — update as phases land.

## 1. Vision

A private, single-owner AI agent that can hold conversations, execute real
multi-step tasks through authorized tools, remember relevant context across
sessions, talk to its owner over Telegram, act on Gmail/Calendar/Drive/GitHub
with explicit approval, run on a schedule, and (eventually) browse the web
autonomously inside a sandbox — all while never fabricating results and
never acting outside what the backend has actually authorized.

The system is built as a single-user product with a data model and API
shape that can grow into a multi-tenant commercial product later without a
rewrite (see `docs/architecture.md` §9 and Phase 10 of the roadmap).

## 2. Primary user

One person (the "owner"), initially the repository's operator. No public
signup, no billing, no org/workspace concepts in v1. Every row in the
database is still owned by a `User` row from day one — there is no implicit
global user baked into business logic.

## 3. Core use cases (v1 target — phases 1–9)

1. **Chat** — owner converses with the agent over a web UI; history persists
   across restarts.
2. **Task execution** — owner asks for something that requires tools
   (e.g. "search for X and summarize", "check my calendar for conflicts
   next week"); the agent plans, executes, and reports a verified result.
3. **Telegram** — owner can do the same from Telegram: create tasks, get
   progress and final reports, check status, cancel, approve/reject.
4. **Memory** — the agent proposes facts/preferences worth remembering;
   owner approves/edits/rejects; approved memories are searchable and
   inform future conversations; owner can export or wipe memory entirely.
5. **Approvals** — anything consequential (send email, create/modify a
   calendar event, delete data, publish something, spend money) requires an
   explicit approval bound to the exact action and parameters, before
   execution — never inferred from model text.
6. **Scheduling** — recurring or one-off jobs (e.g. "every weekday at 8am,
   send me a briefing") persist in Postgres/Redis and survive restarts.
7. **Integrations** — Gmail (read/draft/send-after-approval), Google
   Calendar (read, create/modify-after-approval), Google Drive (read),
   GitHub (later), web search, and eventually isolated browser automation.
8. **Transparency** — dashboard and chat UI always show real backend state:
   task status, tool activity, token/cost usage, connected integrations,
   pending approvals, audit log. No hardcoded demo data.

## 4. Explicit non-goals for v1

- Public registration, multi-tenant orgs, subscription billing, admin
  portal, usage quotas across customers — documented in Phase 10 only.
- Vector database / embeddings store — Postgres full-text search first;
  revisit only if search quality demonstrably requires it.
- Deployment to a public VPS/domain — local-first; VPS deployment is
  documented but not executed in this phase.
- Unrestricted shell/filesystem/network access for the model — every
  capability is a registered, schema-validated, permission-checked tool.
- CAPTCHA bypass or anti-bot evasion in browser automation.

## 5. Success criteria per phase

See `docs/implementation-roadmap.md` for phase-by-phase acceptance
criteria. At a product level, v1 is "done" when the owner can, through
either the web UI or Telegram:

- Have a persistent conversation with the agent.
- Ask it to do something that requires at least two chained tool calls and
  get a truthful, verified report back (including truthful failure).
- Get a consequential action (e.g. send an email) correctly blocked until
  approved, and correctly executed after approval.
- See accurate, real usage/cost numbers for model calls.
- Trust that memory, tasks, and schedules survive an app restart.
- Revoke any integration and confirm the agent can no longer use it.

## 6. Constraints and assumptions

- Local macOS development machine; Docker Desktop available for Postgres
  and Redis.
- Anthropic API access requires **API billing credits**, which are
  separate from a Claude.ai consumer subscription — see
  `docs/architecture.md` §6 and the open question in that doc. This must be
  confirmed before Phase 2 can send a real model request.
- Telegram, Gmail/Calendar/Drive, and any web search provider each need
  credentials the owner must obtain out-of-band (BotFather token, Google
  Cloud OAuth client, search API key). Phase 0 does not require these;
  later phases will fail gracefully and explain what's missing if they are
  absent.
