export type ModelMessageRole = "user" | "assistant" | "system";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** A plain text turn (user/system input, or an assistant turn with no tool calls). */
export interface TextMessage {
  role: ModelMessageRole;
  content: string;
}

/** An assistant turn that requested one or more tool calls. */
export interface AssistantToolCallMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
}

/** The result of executing a previously requested tool call, fed back to the model. */
export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

export type ModelMessage = TextMessage | AssistantToolCallMessage | ToolResultMessage;

/** Tool metadata as presented to the model — no handler, no zod internals. */
export interface ToolSpec {
  name: string;
  description: string;
  inputJsonSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: ModelMessage[];
  /** Omitted or empty for plain chat turns that never need tool use. */
  tools?: ToolSpec[];
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end_turn" | "tool_use";

export interface CompletionResult {
  provider: "anthropic" | "mock";
  model: string;
  stopReason: StopReason;
  content: string;
  toolCalls: ToolCall[];
  usage: CompletionUsage;
}

/**
 * Implemented by every model backend. The agent engine and the chat route
 * depend only on this interface, never on a specific provider's SDK —
 * see docs/architecture.md §6.
 */
export interface ModelProvider {
  readonly name: "anthropic" | "mock";
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * Thrown when AI_PROVIDER names a provider that isn't implemented/wired
 * yet in this build. Never silently falls back to a different provider —
 * the caller must see a real, actionable error.
 */
export class ProviderUnavailableError extends Error {
  constructor(provider: string) {
    super(
      `Model provider "${provider}" is not available in this build. ` +
        `Set AI_PROVIDER=mock, or ask for the Anthropic integration to be added.`,
    );
    this.name = "ProviderUnavailableError";
  }
}
