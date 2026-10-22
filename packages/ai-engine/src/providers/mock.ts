import { randomUUID } from "node:crypto";
import type { CompletionRequest, CompletionResult, ModelProvider, ToolResultMessage, ToolSpec } from "../types.js";

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

function extractUrl(goal: string): string | undefined {
  return goal.match(/https?:\/\/\S+/)?.[0];
}

function mockInputFor(tool: ToolSpec, goal: string): unknown {
  if (tool.name === "search_web" || tool.name === "search_drive_files") {
    return { query: goal };
  }
  if (tool.name === "browse_page" || tool.name === "download_file") {
    return { url: extractUrl(goal) };
  }
  return {};
}

/**
 * Pulls {toolExecutionId, result} out of every successful tool-result
 * message (packages/ai-engine/src/agent/engine.ts embeds this shape on
 * success — see Phase 7) so MockProvider can synthesize a
 * generate_research_report call that cites real ToolExecution rows,
 * exactly like a real model would after being shown the same tool
 * results. Error results aren't JSON and are silently skipped — nothing
 * worth citing came back from them.
 */
function citableSourcesFrom(toolMessages: ToolResultMessage[]): Array<{ toolExecutionId: string; note: string }> {
  const sources: Array<{ toolExecutionId: string; note: string }> = [];
  for (const message of toolMessages) {
    if (message.isError) continue;
    try {
      const parsed = JSON.parse(message.content) as { toolExecutionId?: string };
      if (parsed.toolExecutionId) {
        sources.push({ toolExecutionId: parsed.toolExecutionId, note: `Result from ${message.name}` });
      }
    } catch {
      // Not a JSON-shaped successful result — nothing citable here.
    }
  }
  return sources;
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

    const toolMessages = request.messages.filter((m): m is ToolResultMessage => m.role === "tool");
    const usedToolNames = new Set(toolMessages.map((m) => m.name));
    // generate_research_report can only ever be the LAST tool the mock
    // calls, and only once there's at least one real result to cite —
    // never offered as a candidate before that, so a chained research
    // goal always runs its source-gathering tool(s) first.
    const citableSources = citableSourcesFrom(toolMessages);

    const nextTool = tools.find(
      (tool) =>
        !usedToolNames.has(tool.name) &&
        (tool.name !== "generate_research_report" || citableSources.length > 0) &&
        toolKeywords(tool).some((word) => goalLower.includes(word)),
    );

    const inputTokens = estimateTokens(request.messages.map((m) => ("content" in m ? m.content : "")).join("\n"));

    if (nextTool) {
      const input =
        nextTool.name === "generate_research_report"
          ? {
              title: `Research report: ${goal}`.slice(0, 300),
              summary: `Findings based on ${citableSources.length} tool result(s) for: ${goal}`,
              sources: citableSources,
            }
          : mockInputFor(nextTool, goal);
      return {
        provider: "mock",
        model: request.model,
        stopReason: "tool_use",
        content: "",
        toolCalls: [{ id: randomUUID(), name: nextTool.name, input }],
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
