# Commercial Readiness — Phase 10 (docs only, nothing built here)

This is the Phase 10 deliverable from `docs/implementation-roadmap.md`:
a written analysis of what changes between the Phase 1–9 single-owner
product and a multi-tenant commercial product. No code was written for
this phase — every fact below was verified against the actual Phase 1–9
codebase (file:line references throughout), not assumed from the
original design docs.

## Verdict: not production-ready for multiple paying customers

Ten concrete reasons, each traceable to real code or its absence:

1. **No registration path exists.** The only way to create a `User` row
   is `apps/api/src/scripts/bootstrapOwner.ts:15-19`, a local CLI script
   that refuses to run if any user already exists. There is no
   `POST /register` endpoint anywhere (`apps/api/src/routes/auth.ts`
   defines only `login`/`logout`/`me`).
2. **Every integration secret is one global value for the entire
   deployment** — `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`,
   `GOOGLE_CLIENT_ID`/`SECRET`, `ENCRYPTION_MASTER_KEY` (`.env.example`).
   A second real tenant today would share the first tenant's Telegram
   bot identity and the same AES key protecting all stored OAuth tokens.
3. **Tenant isolation is 100% application-code, 0% database-enforced.**
   Every route does `where: { userId: req.user!.id }` consistently
   (verified across `approvals.ts`, `auditLog.ts`, `conversations.ts`,
   `integrations.ts`, `memories.ts`, `scheduledTasks.ts`,
   `researchReports.ts`, `tasks.ts`, `settings.ts`, `usage.ts`) — but
   there is no Postgres Row-Level Security anywhere. One missed `where`
   clause in a future route is a full cross-tenant data leak that
   nothing in the database itself would catch.
4. **Usage is tracked but never enforced beyond a single task.**
   `AgentSettings` (`schema.prisma:101-116`) caps tool calls, model
   calls, tokens, and cost **per task** — there is no account-wide or
   billing-period ceiling anywhere in the schema or code. A user can run
   unlimited tasks indefinitely with no spend limit.
5. **Rate limiting is in-memory, per-process, per-IP**
   (`apps/api/src/middleware/rateLimit.ts`, `express-rate-limit` with no
   Redis store). It resets on every restart, doesn't work across
   multiple API instances, and isn't even keyed per-user — so it can't
   serve as a fairness boundary between tenants sharing infrastructure.
6. **One static encryption key, no rotation, no KMS.**
   `ENCRYPTION_MASTER_KEY` is a single AES-256-GCM key for every stored
   credential, for the whole deployment (`packages/security/src/
   encryption.ts:20-24`, confirmed as a known v1 limitation in
   `docs/security-model.md:71-74`). `EncryptedCredential.keyVersion`
   exists in the schema but no rotation code uses it.
7. **No deletion/export compliance.** The only export endpoint is
   `GET /memories/export` (`memories.ts:32-35`), scoped to `Memory`
   only — conversations, tasks, usage, and audit history aren't
   exportable. There is no account-deletion endpoint of any kind.
8. **No admin tooling.** No way to list users, suspend an account, or
   inspect a tenant's state without direct database access — not even a
   read-only internal view.
9. **No production monitoring/alerting/support process.** Structured
   logs go to local stdout only; there's no log aggregation, no APM/error
   tracking, no alerting on health-check failures or queue depth, and no
   defined support/on-call process.
10. **No real deployment topology.** `docker-compose.yml` defines only
    `postgres`/`redis` — there is no `api`/`worker`/`web` service, no
    load balancer, no process manager configured anywhere. (The one
    bright spot: sessions are server-side in Postgres and the BullMQ
    queue is Redis-backed and multi-consumer by design, so horizontally
    scaling the API/worker processes themselves isn't blocked by the
    core architecture — see §8 below. The gap is operational tooling,
    not a schema or queueing redesign.)

---

## 1. Public registration + email verification + password reset

**Today:** None of the three exist. `docs/security-model.md:36-38`
already names the intended shape — "Phase 10 documents how registration
would be added later behind an explicit feature flag/invite system" —
but nothing beyond that sentence was built.

**What would need to change:**
- A `POST /register` route, gated behind a feature flag or invite-code
  table (not open signup on day one — abuse/cost risk given unlimited
  model-call spend per §verdict #4).
- Email verification and password reset both require **transactional
  email sending**, which doesn't exist anywhere in this codebase today.
  (The Gmail integration in `packages/integrations/src/google` is a
  per-user OAuth grant for the *agent's own tool use* — reading/sending
  on behalf of a connected user — not an app-level sender for
  verification/reset emails. A provider like Postmark/SES/SendGrid would
  be new infrastructure.)
- Password reset needs a single-use, short-TTL token model — structurally
  identical to the existing `OAuthState` pattern
  (`packages/integrations/src/google/state.ts`), which is a reasonable
  template to copy rather than design from scratch.
- Password hashing is already production-grade as-is: `argon2id`
  (`packages/security/src/password.ts`) needs no change.
- New registration/reset endpoints need the same rate-limiting treatment
  as `/auth/login` (`loginRateLimit`) — copyable pattern, same caveat as
  §verdict #5 about it not surviving multi-instance deployment yet.

## 2. Organizations / workspaces

**Today:** No concept at all. `User` is the only tenancy unit, and it's
1:1 with every owned table (`Conversation`, `Task`, `Memory`,
`ScheduledTask`, `Integration`, `AgentSettings`, etc. — all keyed
directly on `userId`, not on anything resembling an org).

**What would need to change:**
- A new `Organization` model plus a `Membership` join table
  (`userId`, `orgId`, `role`), minimum roles `owner`/`admin`/`member`.
- Every currently `userId`-scoped table needs to either gain an `orgId`
  column or have its scoping resolved through membership at query time.
  This is the single largest schema-touching change in this entire
  document — nearly every model in `docs/database-design.md` is
  affected, not just a handful.
- Product decisions that are *not* engineering decisions and need to be
  made first: does an org share one `AgentSettings`/budget, or does each
  member get their own within a shared billing envelope? Does a
  Telegram/Google connection belong to a user or to the org? These
  determine the shape of the schema change, so they block starting it.

## 3. Tenant isolation beyond `userId` — row-level security evaluation

**Today:** Confirmed consistent `where: { userId }` filtering at the
application layer (§verdict #3), zero Postgres RLS, and every
user-owned table has a non-nullable `userId` foreign key with
`onDelete: Cascade` back to `User` — the architecture doc's claim here
checks out against the actual schema.

**Evaluation of Postgres RLS as the roadmap asks:**
- **Pro:** moves the isolation boundary into the database itself. Even a
  route handler with a forgotten/wrong `where` clause couldn't leak
  cross-tenant rows, because Postgres would enforce
  `current_setting('app.tenant_id') = "tenantId"`-style policies
  regardless of what the application code did.
- **Con:** Prisma doesn't set per-request session state automatically —
  every request/transaction would need to explicitly
  `SET LOCAL app.tenant_id = ...` before querying (via Prisma middleware
  or a pooling proxy). That's a new, easy-to-forget failure mode of its
  own, and policies must be written **default-deny** (no `tenant_id` set
  → no rows visible), not default-allow, or the safety property inverts.
- **Recommendation:** adopt RLS as a defense-in-depth layer once
  Organizations (§2) exist, with policies keyed on `orgId` rather than
  `userId` — org membership changes over time but data stays with the
  org, so `orgId` is the more stable isolation key. Building RLS before
  orgs exist would just re-implement today's `userId`-filter logic with
  extra operational overhead for no additional safety.
- **Telegram special case:** today a single shared `TELEGRAM_WEBHOOK_SECRET`
  authenticates *all* inbound Telegram traffic for the one linked user
  (`apps/api/src/routes/telegramWebhook.ts:17`); the actual per-user
  resolution already happens one layer in, via `TelegramLinkCode` mapping
  a specific chat to a specific user. That per-chat resolution already
  generalizes to many simultaneous linked chats without an architecture
  change — it just hasn't been exercised at that scale and should be
  re-verified under real multi-tenant load, not re-designed.

## 4. Plans, quotas, metering

**Today:** `UsageRecord` already stores per-call token counts and
`estimatedCostMicroUsd` (`schema.prisma:84-99`), and
`GET /api/v1/usage` (added Phase 9) already rolls those up by day — but
read-only. `AgentSettings`'s limits are enforced per-task only
(`packages/ai-engine/src/agent/limits.ts`); nothing sums usage across a
billing period or blocks a new task because of cumulative spend.

**What would need to change:**
- A `Plan` concept (free/pro/etc.) carrying billing-period quotas
  (tokens, tasks, cost) — additive to, not a replacement for, today's
  per-task `AgentSettings` caps, which should remain as an
  always-on safety net regardless of plan.
- One new enforcement point: before `createAndEnqueueTask`
  (`apps/api/src/routes/tasks.ts`), sum the current period's
  `UsageRecord` rows and reject if over quota — the same shape as the
  existing `ConcurrentTaskLimitError` check, not a new mechanism.
- No new tracking primitive is needed; `estimatedCostMicroUsd` already
  has the granularity a billing-period rollup requires. This is mostly
  a `Plan`/`Subscription` model plus one guard clause, not a tracking
  rebuild.

## 5. Billing integration

**Today:** Nothing. No payment provider code, no `Subscription` model,
no webhook handler for billing events.

**What would need to change:**
- A `Subscription` model (`stripeCustomerId`, `stripeSubscriptionId`,
  `plan`, `status`, `currentPeriodEnd`) tied to `Organization` (§2) or
  `User`, depending on that product decision.
- A billing webhook handler for lifecycle events (created, updated,
  canceled, payment failed). `telegramWebhook.ts` is a reasonable
  structural template — verify signature, process idempotently — even
  though the business logic is entirely new.
- Grace-period/dunning handling before suspending access on failed
  payment — a policy decision as much as an engineering one.
- This is the most purely additive item on the list: essentially nothing
  in the current codebase overlaps with it beyond the webhook-handling
  *pattern*.

## 6. Admin tooling

**Today:** None. No admin role, no internal dashboard, no way to list or
suspend a user without direct `psql` access to the database.

**What would need to change:**
- An admin-role concept, and an explicit decision on whether admins get
  impersonation capability — if so, that must be time-boxed and fully
  logged via the `AuditLog` added in Phase 9
  (`packages/security/src/auditLog.ts`), and visible to the affected
  user, not silent.
- Minimum viable surface: list users/orgs, view usage and billing
  status, suspend/reactivate an account, browse (redacted) `AuditLog`
  entries across tenants.
- This is comparatively low-risk to build: it's mostly new routes and
  web pages following patterns that already exist (the Phase 9
  dashboard's query style, `AuditLog` as the audit trail) rather than
  new architecture.

## 7. Data export and deletion compliance

**Today:** `GET /memories/export` (`memories.ts:32-35`) is the only
export endpoint in the codebase, and it covers `Memory` rows only —
conversations, tasks, tool executions, research reports, usage, and
audit history are not exportable anywhere. There is no account-deletion
endpoint. Cascading deletes **are** correctly wired at the schema level
— every user-owned table has `onDelete: Cascade` back to `User` (§verdict
#3) — so a direct `User` row deletion would clean up correctly today,
but no application code ever performs it.

**What would need to change:**
- A full account-data export assembling every `userId`-scoped table into
  one bundle, generalizing the pattern `memories.ts` already
  demonstrates rather than inventing a new one.
- A real "delete my account" endpoint. The deletion mechanics are nearly
  free given the cascades already work — the actual work is a
  confirmation flow, a cooling-off period before the delete fires (common
  practice, not universally legally required), and a conflict that needs
  an explicit policy before building anything: many compliance regimes
  *require* retaining audit/billing records for a defined period even
  after account deletion, which directly conflicts with
  cascade-delete-everything. `AuditLog` retention specifically needs a
  deliberate decision here, not an assumption that cascade-works-so-ship-it.
- Whether this needs to satisfy GDPR, CCPA, or neither is a legal
  question dependent on where customers are located — flagged for legal
  review before implementation, not resolved in this document.

## 8. Production monitoring and support processes

**Today:** `pino` structured logs to local stdout, redacted per
`docs/security-model.md` §4; `GET /health` and `/health/ready` (Phase 1);
a global JSON error handler and process-level
`uncaughtException`/`unhandledRejection` handlers that log at `fatal`
and `process.exit(1)` (Phase 9) — which assumes an external process
manager restarts the process, but **no process manager is actually
configured anywhere** (`docker-compose.yml` defines only `postgres` and
`redis`, no `api`/`worker`/`web` service).

**What would need to change:**
- Actual process supervision in any real deployment — at minimum Docker
  restart policies, or a proper orchestrator. This is pure deployment
  configuration, not application code.
- Centralized log aggregation (today: local stdout only) and an
  error-tracking/APM service (e.g. Sentry) — `AuditLog` is a
  business-event trail for compliance/support, not a substitute for
  operational error tracking.
- Alerting on health-check failures, elevated error rate, and queue
  depth (BullMQ already exposes the metrics needed for the last one) —
  none of this exists today.
- Rate limiting (§verdict #5) needs to move from in-memory
  `express-rate-limit` to a Redis-backed store — Redis is already in the
  stack for BullMQ — before any multi-instance deployment, or it
  silently stops limiting anything per-instance.
- An actual support process: who gets paged, how a paying customer
  reports an issue and gets a response, what the SLA is. Organizational,
  not technical — can't be solved by writing more code.
- Infra note worth keeping in mind while scoping this work: sessions are
  already server-side in Postgres (resolved per-request from a stateless
  cookie, `apps/api/src/auth/session.ts:42-54`) and the BullMQ queue is
  already Redis-backed and multi-consumer by design
  (`apps/api/src/queueConnection.ts`) — so horizontally scaling the
  API/worker processes themselves is not blocked by the core
  architecture. The real gap is the operational tooling around it
  (process supervision, log aggregation, a shared rate-limit store), not
  a queueing or session redesign.

---

## What's already not a blocker

Decisions made during Phase 1–9 that reduce the size of this list rather
than add to it:
- Every user-owned table has carried a non-nullable `userId` foreign key
  since it was created — no implicit single-user shortcuts to unwind.
- The API has been versioned under `/api/v1` since Phase 1
  (`docs/api-contracts.md:138-140`), specifically so a breaking v2 for
  multi-tenant changes doesn't require an immediate migration scramble.
- Password hashing (`argon2id`) and credential encryption (AES-256-GCM)
  are already algorithm-appropriate for production — what's missing is
  key management (rotation, KMS), not the cryptography itself.
- `AuditLog` (Phase 9) already exists and is the right foundation for
  both admin tooling (§6) and compliance retention policy (§7) — it
  doesn't need to be invented from scratch when this work starts.
- Sessions and the task queue are architecturally ready for horizontal
  scaling today (§8) — the gap there is operational, not structural.
