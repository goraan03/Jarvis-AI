import type { ModelProvider } from "../types.js";
import { ProviderUnavailableError } from "../types.js";
import { MockProvider } from "./mock.js";

/**
 * Only "mock" is wired up right now (by explicit product decision — the
 * Anthropic integration is added in a later step once API billing is
 * confirmed). Requesting "anthropic" fails loudly rather than silently
 * running mock responses under a real-provider label.
 */
export function createModelProvider(aiProvider: "mock" | "anthropic"): ModelProvider {
  if (aiProvider === "mock") {
    return new MockProvider();
  }
  throw new ProviderUnavailableError(aiProvider);
}

export { MockProvider } from "./mock.js";
