export type ModelMessageRole = "user" | "assistant" | "system";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ModelMessage[];
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  content: string;
  provider: "anthropic" | "mock";
  model: string;
  usage: CompletionUsage;
}

/**
 * Implemented by every model backend. The agent engine (Phase 3) and the
 * chat route (Phase 2) depend only on this interface, never on a specific
 * provider's SDK — see docs/architecture.md §6.
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
