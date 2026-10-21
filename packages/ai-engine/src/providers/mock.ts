import { randomUUID } from "node:crypto";
import type { CompletionRequest, CompletionResult, ModelProvider, ToolSpec } from "../types.js";

// Rough, provider-agnostic token estimate (chars/4) — good enough for a
// mock that exists to make usage/cost UI testable, not to be billed on.
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function toolKeywords(tool: ToolSpec): string[] {
  return tool.name
    .replace(/^(get|search|read|create)_/, "")
    .split("_")
    .filter((word) => word.length > 2);
}

function mockInputFor(tool: ToolSpec, goal: string): unknown {
  if (tool.name === "search_web") {
    return { query: goal };
  }
  return {};
}

/**
 * Deterministic, no-network provider for local dev/tests. Simulates tool
 * use by keyword-matching the original goal against each available
 * tool's name (e.g. a goal mentioning "time" triggers get_current_time),
 * calling at most one not-yet-used matching tool per turn, then producing
 * a final answer once no more tools match. Every response is clearly
 * tagged provider: "mock" end-to-end so a mock run can never be mistaken
 * for a real model execution — docs/architecture.md §6.
 */
export class MockProvider implements ModelProvider {
  readonly name = "mock" as const;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const tools = request.tools ?? [];
    const goalMessage = request.messages.find((m) => m.role === "user");
    const goal = goalMessage && "content" in goalMessage ? goalMessage.content : "";
    const goalLower = goal.toLowerCase();

    const usedToolNames = new Set(request.messages.filter((m) => m.role === "tool").map((m) => m.name));

    const nextTool = tools.find(
      (tool) => !usedToolNames.has(tool.name) && toolKeywords(tool).some((word) => goalLower.includes(word)),
    );

    const inputTokens = estimateTokens(request.messages.map((m) => ("content" in m ? m.content : "")).join("\n"));

    if (nextTool) {
      return {
        provider: "mock",
        model: request.model,
        stopReason: "tool_use",
        content: "",
        toolCalls: [{ id: randomUUID(), name: nextTool.name, input: mockInputFor(nextTool, goal) }],
        usage: { inputTokens, outputTokens: estimateTokens(nextTool.name) },
      };
    }

    const toolResults = request.messages.filter((m) => m.role === "tool");
    const summary =
      toolResults.length > 0
        ? `Used tools — ${toolResults.map((m) => `${m.name}: ${m.content}`).join("; ")}.`
        : "No tools were needed.";
    const content =
      `[mock response] Goal: "${goal}". ${summary} ` +
      `This is a deterministic placeholder from MockProvider — no real model was called.`;

    return {
      provider: "mock",
      model: request.model,
      stopReason: "end_turn",
      content,
      toolCalls: [],
      usage: { inputTokens, outputTokens: estimateTokens(content) },
    };
  }
}
