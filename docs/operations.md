# Operations — Jarvis

Status: Phase 0 skeleton; filled in as each phase introduces operable
surface area.

## Health & observability (Phase 1+)

- `GET /api/v1/health` (liveness) and `/api/v1/health/ready` (DB + Redis
  connectivity) — used for manual checks initially; wire into any
  process manager once deployed.
- Structured logs via `pino`, redacted per `security-model.md` §4, to
  stdout in dev (readable via `pino-pretty` locally) and to a file/
  collector in any future deployment.

## Backups (finalized in Phase 9, documented now)

- Postgres is the single source of truth for everything except raw OAuth
  tokens' plaintext (which never exists on disk — only ciphertext is
  stored, and the master key is backed up separately from the DB dump by
  design, so a DB leak alone doesn't expose credentials).
- `pg_dump` on a schedule once there's a persistent deployment; for local
  dev, the Docker volume is the "backup" until Phase 9 formalizes
  anything further.
- Restore procedure is written and actually drilled once (restore into a
  fresh database, verify row counts / spot-check key tables) before
  Phase 9 is considered complete.

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
