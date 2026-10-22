export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  channel: "WEB" | "TELEGRAM";
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  providerUsed: string | null;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface Task {
  id: string;
  goal: string;
  status: TaskStatus;
  planSummary: string | null;
  resultSummary: string | null;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStep {
  id: string;
  stepIndex: number;
  kind: "MODEL_TURN" | "TOOL_CALL_REQUESTED" | "APPROVAL_REQUESTED" | "RETRY" | "LIMIT_EXCEEDED";
  detail: unknown;
  createdAt: string;
}

export interface ToolExecution {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED_PERMISSION" | "BLOCKED_APPROVAL";
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface TaskDetail extends Task {
  steps: TaskStep[];
  toolExecutions: ToolExecution[];
}

export interface Integration {
  provider: string;
  status: "connected" | "disconnected";
  externalId: string | null;
  metadata: { username?: string; firstName?: string; email?: string } | null;
  updatedAt: string;
}

export interface LinkCodeResponse {
  code: string;
  expiresAt: string;
  deepLink: string | null;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  toolName: string;
  boundInput: Record<string, unknown>;
  status: ApprovalStatus;
  requestedVia: "WEB" | "TELEGRAM";
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export type MemoryStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "ARCHIVED";

export interface Memory {
  id: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export type ScheduledTaskRunStatus = "created" | "skipped_concurrency_limit" | "failed";

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string | null;
  runAt: string | null;
  timezone: string;
  payload: { goal: string };
  status: "active" | "paused" | "cancelled";
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  idempotencyKey: string;
  taskId: string | null;
  status: ScheduledTaskRunStatus;
  createdAt: string;
}
