# Operations — Jarvis

Status: Phase 0 skeleton; filled in as each phase introduces operable
surface area.

## Health & observability (Phase 1+, error handling finalized Phase 9)

- `GET /api/v1/health` (liveness) and `/api/v1/health/ready` (DB + Redis
  connectivity) — used for manual checks initially; wire into any
  process manager once deployed.
- Structured logs via `pino`, redacted per `security-model.md` §4, to
  stdout in dev (readable via `pino-pretty` locally) and to a file/
  collector in any future deployment.
- `apps/api`: every unhandled route error (including rejected promises
  from async handlers, which Express 5 forwards automatically) hits
  `apps/api/src/middleware/errorHandler.ts` — logged with full detail
  server-side, but the client only ever receives a generic
  `{ error: { code: "INTERNAL_ERROR" } }` JSON body, never a stack trace
  or Express's default HTML error page.
- `apps/api` and `apps/worker` both install `uncaughtException`/
  `unhandledRejection` handlers that log via `pino` at `fatal` and then
  `process.exit(1)`. There's no in-process self-healing — a process
  manager (Docker restart policy, systemd, or just re-running `npm run
  dev:api`/`dev:worker` in local dev) is the actual uptime mechanism.
  Fail loud and let something outside the broken process restart it,
  rather than limping along on corrupted state. BullMQ job-level errors
  (a tool handler throwing) are caught by BullMQ itself and surfaced via
  `worker.on("failed", ...)` — they never reach these process-level
  handlers or kill the worker.
- `AuditLog` (Phase 9): every login/logout, approval decision, integration
  connect/disconnect, and tool execution writes a redacted row via
  `packages/security.writeAuditLog()` — visible on the **Activity** page,
  queryable via `GET /api/v1/audit-log`.

## Backups (finalized Phase 9 — drilled for real, not just documented)

- Postgres is the single source of truth for everything except raw OAuth
  tokens' plaintext (which never exists on disk — only ciphertext is
  stored, and the master key is backed up separately from the DB dump by
  design, so a DB leak alone doesn't expose credentials).
- `pg_dump` on a schedule once there's a persistent deployment; for local
  dev, the Docker volume is sufficient day-to-day, but the dump/restore
  procedure below is what you'd actually run to recover from a lost or
  corrupted volume.

### Commands (run against the `jarvis-postgres-1` container, matching the
server's own `pg_dump`/`pg_restore` version — a host-installed client at a
different major version can produce or read dumps incorrectly):

```bash
# Dump (custom format — compressed, supports selective/parallel restore)
docker exec jarvis-postgres-1 pg_dump -U jarvis -Fc -f /tmp/jarvis_backup.dump jarvis
docker cp jarvis-postgres-1:/tmp/jarvis_backup.dump ./jarvis_backup.dump

# Restore into a fresh database
docker cp ./jarvis_backup.dump jarvis-postgres-1:/tmp/jarvis_backup.dump
docker exec jarvis-postgres-1 createdb -U jarvis jarvis_restore_drill
docker exec jarvis-postgres-1 pg_restore -U jarvis -d jarvis_restore_drill /tmp/jarvis_backup.dump
```

### Drill actually performed (2026-10-22)

Dumped the real local dev database (`jarvis`, 1 user, 8 tasks, 7 tool
executions, 1 integration, 1 approval request, 1 scheduled task — `0`
memories/research reports/audit log entries at drill time), restored it
into a fresh `jarvis_restore_drill` database, and verified:

- Row counts for every table matched source exactly (`User`, `Task`,
  `ToolExecution`, `Memory`, `ResearchReport`, `AuditLog`, `Integration`,
  `ApprovalRequest`, `ScheduledTask`).
- Spot-checked actual row content (not just counts): the owner's `User`
  row and the most recent `Task` row (goal text, status) matched
  byte-for-byte between source and restored database.
- `pg_restore` completed with no errors.
- Drill database dropped afterward (`dropdb jarvis_restore_drill`) — it
  was scratch, not a kept backup.

## Incident/runbook notes (grows over time)

- If `ANTHROPIC_API_KEY` requests start failing: check
  console.anthropic.com billing status first (not a code issue) — see
  `architecture.md` §6.
- If Telegram webhook stops receiving updates: check the bot's webhook
  info endpoint (`getWebhookInfo`) for delivery errors before assuming
  application-level bugs.
- If a scheduled task double-fires: check `ScheduledTask.bullJobId`
  reconciliation logs on the most recent worker boot — this is the known
  risk area (risk-register.md #13).

## Known limitations (updated every phase, never left implicit)

- v1 is single-user; see `architecture.md` §9 and Phase 10 for what's
  missing for multi-tenant/commercial use.
- Local encryption key management is weaker than a managed KMS
  (security-model.md §4, risk-register.md #8).
- No production deployment exists until the owner explicitly requests
  one (deployment.md).
