# Database Design — Jarvis (Phase 0 draft)

PostgreSQL via Prisma. Models below are introduced incrementally per
phase (noted), but the ownership pattern is fixed from Phase 1 onward:
every user-owned table has a non-nullable `userId` FK with `onDelete:
Cascade` from `User`, so deleting the owner cleanly deletes their data
(needed for the "account deletion" story even in single-user v1).

Conventions: `id` = `cuid()`, `createdAt`/`updatedAt` on every table,
soft fields use nullable columns rather than separate tables, enums via
Prisma `enum`, money/cost stored as integer micro-dollars to avoid float
rounding, all FKs indexed.

## Phase 1–2 models

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  displayName  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  sessions       Session[]
  conversations  Conversation[]
  tasks          Task[]
  integrations   Integration[]
  memories       Memory[]
  scheduledTasks ScheduledTask[]
  approvals      ApprovalRequest[]
  auditLogs      AuditLog[]
  usageRecords   UsageRecord[]
  settings       AgentSettings?
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique   // hash of the session cookie value, never the raw value
  userAgent String?
  ipHash    String?             // hashed, not raw IP, for privacy-conscious auditing
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}

model Conversation {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String?
  channel   Channel   @default(WEB)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
  tasks     Task[]

  @@index([userId])
}

enum Channel {
  WEB
  TELEGRAM
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           MessageRole
  content        String       // model-facing text; tool-call detail lives on TaskStep/ToolExecution
  providerUsed   String?      // 'anthropic' | 'mock', set only on ASSISTANT messages
  createdAt      DateTime     @default(now())

  @@index([conversationId])
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}
```

## Phase 3 models (agent engine)

```prisma
model Task {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversationId String?
  conversation   Conversation? @relation(fields: [conversationId], references: [id])
  goal           String        // the user's original request, verbatim
  status         TaskStatus    @default(PENDING)
  planSummary    String?       // concise, user-visible plan (not raw chain-of-thought)
  resultSummary  String?       // final verified report
  failureReason  String?
  limits         Json          // snapshot of limits in effect: maxToolCalls, maxModelCalls,
                                // maxDurationMs, maxTokens, maxCostMicroUsd, maxRetries
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  steps            TaskStep[]
  toolExecutions   ToolExecution[]
  approvalRequests ApprovalRequest[]

  @@index([userId, status])
}

enum TaskStatus {
  PENDING
  PLANNING
  RUNNING
  AWAITING_APPROVAL
  COMPLETED
  FAILED
  CANCELLED
}

model TaskStep {
  id        String   @id @default(cuid())
  taskId    String
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  stepIndex Int
  kind      StepKind
  detail    Json      // model turn summary, or tool-call request, kept structured
  createdAt DateTime  @default(now())

  @@index([taskId, stepIndex])
}

enum StepKind {
  MODEL_TURN
  TOOL_CALL_REQUESTED
  APPROVAL_REQUESTED
  RETRY
  LIMIT_EXCEEDED
}

model ToolExecution {
  id            String     @id @default(cuid())
  taskId        String
  task          Task       @relation(fields: [taskId], references: [id], onDelete: Cascade)
  toolName      String
  input         Json        // validated against the tool's input schema before storage
  output        Json?       // validated against the tool's output schema; null until done
  status        ToolExecStatus @default(PENDING)
  errorMessage  String?
  durationMs    Int?
  riskLevel     String      // snapshot of the tool's risk classification at call time
  createdAt     DateTime   @default(now())
  completedAt   DateTime?

  @@index([taskId])
  @@index([toolName])
}

enum ToolExecStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  BLOCKED_PERMISSION
  BLOCKED_APPROVAL
}
```

## Phase 4–5 models (integrations, approvals)

```prisma
model Integration {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider    String   // 'telegram' | 'gmail' | 'google_calendar' | 'google_drive' | 'github'
  status      String   // 'connected' | 'disconnected' | 'error' | 'needs_reauth'
  externalId  String?  // e.g. Telegram chat id, Google account email
  scopes      String[]
  metadata    Json?    // non-secret details only (never tokens)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  credential  EncryptedCredential?

  @@unique([userId, provider])
}

model EncryptedCredential {
  id            String      @id @default(cuid())
  integrationId String      @unique
  integration   Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  ciphertext    Bytes
  iv            Bytes
  authTag       Bytes
  keyVersion    Int         @default(1)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
}

model ApprovalRequest {
  id            String          @id @default(cuid())
  userId        String
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  taskId        String?
  task          Task?           @relation(fields: [taskId], references: [id])
  toolName      String
  boundInput    Json             // exact action + parameters this approval authorizes
  inputHash     String           // hash of boundInput, re-checked at execution time
  status        ApprovalStatus  @default(PENDING)
  requestedVia  Channel
  decidedAt     DateTime?
  expiresAt     DateTime
  createdAt     DateTime        @default(now())

  @@index([userId, status])
}

enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
  EXPIRED
  CANCELLED
}
```

## Phase 6 models (memory, scheduler)

```prisma
model Memory {
  id         String        @id @default(cuid())
  userId     String
  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  category   String        // 'fact' | 'preference' | 'project' | ...
  content    String
  source     String        // 'conversation' | 'task' | 'manual'
  confidence Float         @default(1.0)
  status     MemoryStatus  @default(PROPOSED)
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt

  @@index([userId, status])
}

enum MemoryStatus {
  PROPOSED
  APPROVED
  REJECTED
  ARCHIVED
}
```

Full-text search: a generated `tsvector` column + GIN index on
`Memory.content` (Postgres native `to_tsvector('english', content)`), no
separate search service.

```prisma
model ScheduledTask {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  cronExpression String?  // null for one-time
  runAt          DateTime? // for one-time jobs
  timezone       String
  payload        Json      // what to execute — e.g. a templated task goal
  status         String    // 'active' | 'paused' | 'cancelled'
  bullJobId      String?   // repeatable job key in BullMQ, for reconciliation
  lastRunAt      DateTime?
  lastStatus     String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([userId, status])
}
```

## Phase 2/3/9 cross-cutting models

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  action    String   // e.g. 'tool.execute', 'approval.approve', 'integration.disconnect'
  entityType String?
  entityId   String?
  metadata   Json?   // redacted — no secrets, enforced by packages/security before write
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
}

model UsageRecord {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  taskId          String?
  provider        String   // 'anthropic' | 'mock'
  model           String
  inputTokens     Int
  outputTokens    Int
  estimatedCostMicroUsd Int
  createdAt       DateTime @default(now())

  @@index([userId, createdAt])
}

model AgentSettings {
  id                   String   @id @default(cuid())
  userId               String   @unique
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  defaultModel          String
  maxToolCallsPerTask   Int      @default(25)
  maxModelCallsPerTask  Int      @default(15)
  maxTaskDurationMs     Int      @default(300000)
  maxTokensPerTask      Int      @default(200000)
  maxCostMicroUsdPerTask Int     @default(500000) // $0.50 default cap
  maxConcurrentTasks     Int     @default(2)
  autoMemoryEnabled      Boolean @default(true)
  approvalExceptions     Json?   // narrowly scoped auto-approve rules, owner-configured
  updatedAt              DateTime @updatedAt
}
```

## Notes

- Transactions: task-state transitions that touch multiple tables (e.g.
  creating a `Task` + its first `TaskStep`, or deciding an
  `ApprovalRequest` + flipping the blocked `ToolExecution` to runnable) go
  through a single Prisma `$transaction`.
- Deletion behavior: cascading deletes from `User` for a full account
  wipe; `Memory`/`AuditLog`/`UsageRecord` support user-initiated row-level
  deletion and export without deleting the parent `User`.
- Migration policy: every schema change is a new `prisma migrate dev`
  migration file, committed; no manual SQL edits to the dev database
  that bypass Prisma's migration history.
