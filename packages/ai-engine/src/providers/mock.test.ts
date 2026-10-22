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

describe("MockProvider research chaining", () => {
  const tools = [
    { name: "search_web", description: "x", inputJsonSchema: {} },
    { name: "generate_research_report", description: "x", inputJsonSchema: {} },
  ];

  it("does not call generate_research_report before any source has been gathered", async () => {
    const provider = createModelProvider("mock");
    const result = await provider.complete({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "research the mock topic on the web" }],
      tools,
    });
    expect(result.toolCalls[0]?.name).toBe("search_web");
  });

  it("cites the real toolExecutionId from a prior successful tool result once one exists", async () => {
    const provider = createModelProvider("mock");
    const result = await provider.complete({
      model: "claude-sonnet-5",
      messages: [
        { role: "user", content: "research the mock topic on the web" },
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "search_web", input: { query: "x" } }] },
        {
          role: "tool",
          toolCallId: "call-1",
          name: "search_web",
          isError: false,
          content: JSON.stringify({ toolExecutionId: "real-execution-id", result: { results: [] } }),
        },
      ],
      tools,
    });
    expect(result.toolCalls[0]?.name).toBe("generate_research_report");
    const input = result.toolCalls[0]?.input as { sources: Array<{ toolExecutionId: string }> };
    expect(input.sources).toEqual([{ toolExecutionId: "real-execution-id", note: "Result from search_web" }]);
  });

  it("never cites a failed tool result (which carries no toolExecutionId)", async () => {
    const provider = createModelProvider("mock");
    const result = await provider.complete({
      model: "claude-sonnet-5",
      messages: [
        { role: "user", content: "research the mock topic on the web" },
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "search_web", input: { query: "x" } }] },
        { role: "tool", toolCallId: "call-1", name: "search_web", isError: true, content: "Error: boom" },
      ],
      tools,
    });
    // No citable source exists yet, so generate_research_report is withheld
    // entirely rather than being called with an empty/fabricated source list.
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });
});

describe("createModelProvider", () => {
  it("throws a clear error for the unimplemented anthropic provider", () => {
    expect(() => createModelProvider("anthropic")).toThrow(ProviderUnavailableError);
  });
});
