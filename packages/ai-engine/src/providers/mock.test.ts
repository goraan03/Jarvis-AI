import { describe, expect, it } from "vitest";
import { createModelProvider } from "./index.js";
import { ProviderUnavailableError } from "../types.js";

describe("MockProvider", () => {
  it("echoes the last user message, tagged as mock", async () => {
    const provider = createModelProvider("mock");
    const result = await provider.complete({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hello there" }],
    });
    expect(result.provider).toBe("mock");
    expect(result.content).toContain("hello there");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});

describe("createModelProvider", () => {
  it("throws a clear error for the unimplemented anthropic provider", () => {
    expect(() => createModelProvider("anthropic")).toThrow(ProviderUnavailableError);
  });
});
