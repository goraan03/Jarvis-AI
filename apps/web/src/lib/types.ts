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
