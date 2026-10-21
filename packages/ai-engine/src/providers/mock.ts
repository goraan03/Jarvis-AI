import type { CompletionRequest, CompletionResult, ModelProvider } from "../types.js";

// Rough, provider-agnostic token estimate (chars/4) — good enough for a
// mock that exists to make usage/cost UI testable, not to be billed on.
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Deterministic, no-network provider for local dev/tests. Every response
 * is clearly tagged provider: "mock" end-to-end (Message.providerUsed,
 * UsageRecord.provider) so a mock run can never be mistaken for a real
 * model execution — docs/architecture.md §6.
 */
export class MockProvider implements ModelProvider {
  readonly name = "mock" as const;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const content = lastUser
      ? `[mock response] You said: "${lastUser.content.slice(0, 200)}". ` +
        `This is a deterministic placeholder from MockProvider — no real model was called.`
      : "[mock response] (no user message found)";

    const inputTokens = estimateTokens(request.messages.map((m) => m.content).join("\n"));
    const outputTokens = estimateTokens(content);

    return {
      content,
      provider: "mock",
      model: request.model,
      usage: { inputTokens, outputTokens },
    };
  }
}
