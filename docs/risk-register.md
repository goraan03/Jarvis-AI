# Risk Register — Jarvis (Phase 0)

Reviewed/updated at the start of each phase. Likelihood/impact are
qualitative (Low/Medium/High).

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Anthropic API access assumed but not actually billed (consumer Claude subscription ≠ API credits) | Medium | High — blocks all real model calls | Confirmed as an explicit Phase 0 open question; `MockProvider` lets Phases 1–3 plumbing proceed regardless; Phase 2 gate explicitly checks for this before claiming success |
| 2 | Scope is very large for one person/session to build correctly | High | Medium | Strict phase gating, no "build everything now"; each phase has a concrete, testable gate before moving on |
| 3 | Uncapped or misconfigured model usage causes real cost overrun | Medium | Medium | Hard limits enforced in code (`AgentSettings`: max tool/model calls, tokens, cost per task, concurrency), not just documented; `UsageRecord` visible in UI from Phase 2 |
| 4 | Google OAuth consent screen restrictions (sensitive scopes like Gmail send require verification for >100 users / public apps) | Low for single test user | Medium if it blocks Phase 5 | Register the OAuth app in "Testing" publishing status with the owner's own account as a test user — avoids verification requirement at this scale; document the verification requirement for Phase 10 |
| 5 | Telegram webhooks require a public HTTPS endpoint; local dev has none | Medium | Low | Use long-polling (`getUpdates`) for local development, switch to webhook only when a deployed/public endpoint exists; both paths share the same handler code |
| 6 | Browser automation (Phase 8) is the largest security surface (SSRF, arbitrary page content, downloads) | Medium | High | Isolated worker process, egress allowlist/denylist including cloud metadata IP, per-task resource limits, built only after core agent + approvals are proven stable (sequenced last among integrations) |
| 7 | Prompt injection via untrusted tool content (emails, web pages, docs) tricks the model into requesting unauthorized actions | Medium | High | Authorization/approval enforced in backend code that never trusts model output as proof of permission (security-model.md §5–6); tested explicitly, not assumed |
| 8 | Local encryption-key management (single `ENCRYPTION_MASTER_KEY` env var) is weaker than a managed KMS | High (by design, for v1) | Medium | Explicitly documented as a v1 limitation with a clear upgrade path (envelope encryption + KMS) before any production/multi-user use |
| 9 | Single-process worker becomes a bottleneck or SPOF as task volume grows | Low at single-user scale | Low | Modular monolith + BullMQ already allows horizontal worker scaling (more consumers) without architecture changes if ever needed |
| 10 | Dependency/version drift (fast-moving ecosystem: Prisma, BullMQ, Anthropic SDK) | Medium | Low | Pin versions in `package.json`, verify against official docs before use per repo instructions, avoid bleeding-edge pre-release versions |
| 11 | Node 25.2.1 installed locally is a very recent "Current" release, not an LTS line | Low | Low | Target `engines.node >= 20` for broad compatibility; document the local dev version; revisit if any dependency lacks support |
| 12 | Owner loses the encryption master key or the bootstrap owner password | Low | High (data recovery impossible for credentials; account lockout) | Document explicitly at generation time; back-up guidance in deployment.md; this is a real, accepted tradeoff of local-first single-user design |
| 13 | Scheduler duplicate execution on worker restart/crash mid-job | Medium | Medium | Idempotency keys + Postgres reconciliation of BullMQ repeatables on boot (architecture.md §8); explicit test in Phase 6 gate |
| 14 | Claiming a phase "done" when tests weren't actually run or integration wasn't actually exercised with real credentials | Medium (easy failure mode for AI-assisted dev) | High (false confidence) | Explicit end-of-phase report format requires real command output, not assumed results; repo instructions forbid fabricating success |
