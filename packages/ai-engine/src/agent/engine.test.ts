import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { runAgentTask } from "./engine.js";
import { buildTaskLimits, type TaskLimits } from "./limits.js";
import { getCurrentTimeTool } from "../tools/getCurrentTime.js";
import type { ToolDefinition } from "../tools/types.js";
import { createModelProvider } from "../providers/index.js";
import type { CompletionRequest, CompletionResult, ModelProvider } from "../types.js";

async function makeTask(goal: string, limitOverrides: Partial<TaskLimits> = {}) {
  const email = `${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword("x"), settings: { create: {} } },
  });
  const settings = await prisma.agentSettings.findUniqueOrThrow({ where: { userId: user.id } });
  const limits: TaskLimits = { ...buildTaskLimits(settings), ...limitOverrides };
  const task = await prisma.task.create({ data: { userId: user.id, goal, limits } });
  return { user, task, limits };
}

/** A harmless second tool, deliberately accepting {} like get_current_time,
 * so a happy-path test can chain two real tool calls without network I/O. */
const echoTool: ToolDefinition<Record<string, never>, { echoed: string }> = {
  name: "echo_text",
  description: "Echoes a fixed string back.",
  inputSchema: z.object({}),
  outputSchema: z.object({ echoed: z.string() }),
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  riskLevel: "low",
  requiresApproval: false,
  timeoutMs: 1000,
  async handler() {
    return { echoed: "echo text done" };
  },
};

class ScriptedProvider implements ModelProvider {
  readonly name = "mock" as const;
  callCount = 0;
  constructor(private script: CompletionResult[]) {}
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    const result = this.script[Math.min(this.callCount, this.script.length - 1)];
    this.callCount++;
    return result;
  }
}

function endTurn(content: string): CompletionResult {
  return { provider: "mock", model: "test", stopReason: "end_turn", content, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
}

function toolUse(name: string, input: unknown): CompletionResult {
  return {
    provider: "mock",
    model: "test",
    stopReason: "tool_use",
    content: "",
    toolCalls: [{ id: randomUUID(), name, input }],
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe("runAgentTask — happy path", () => {
  it("calls a tool, gets a result, calls another tool, then answers (real MockProvider)", async () => {
    const { task } = await makeTask("Please check the current time and then echo text back to me");
    await runAgentTask(task.id, { modelProvider: createModelProvider("mock"), tools: [getCurrentTimeTool, echoTool] });

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("COMPLETED");
    expect(finished.resultSummary).toContain("get_current_time");
    expect(finished.resultSummary).toContain("echo_text");

    const executions = await prisma.toolExecution.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    expect(executions.map((e) => e.toolName)).toEqual(["get_current_time", "echo_text"]);
    expect(executions.every((e) => e.status === "SUCCEEDED")).toBe(true);

    const steps = await prisma.taskStep.findMany({ where: { taskId: task.id } });
    expect(steps.filter((s) => s.kind === "MODEL_TURN")).toHaveLength(3);

    const usage = await prisma.usageRecord.findMany({ where: { taskId: task.id } });
    expect(usage).toHaveLength(3);
    expect(usage.every((u) => u.provider === "mock")).toBe(true);
  });
});

describe("runAgentTask — invalid tool input", () => {
  it("rejects invalid input before the handler runs", async () => {
    const { task } = await makeTask("irrelevant goal");
    const strictTool: ToolDefinition<{ text: string }, { text: string }> = {
      name: "strict_echo",
      description: "Requires a text field.",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      inputJsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 1000,
      handler: vi.fn(async () => {
        throw new Error("handler should never run for invalid input");
      }),
    };

    const provider = new ScriptedProvider([
      toolUse("strict_echo", { wrongField: 123 }),
      endTurn("done"),
    ]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [strictTool] });

    expect(strictTool.handler).not.toHaveBeenCalled();
    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.status).toBe("FAILED");
    expect(execution.errorMessage).toContain("Invalid input");

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("COMPLETED");
  });
});

describe("runAgentTask — limits", () => {
  it("fails with a clear reason when the model-call budget is exhausted, without hanging", async () => {
    const { task } = await makeTask("goal", { maxModelCallsPerTask: 1 });
    const provider = new ScriptedProvider([toolUse("get_current_time", {}), toolUse("get_current_time", {})]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [getCurrentTimeTool] });

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("FAILED");
    expect(finished.failureReason).toMatch(/model call/i);
    expect(provider.callCount).toBe(1);
  });

  it("fails with a clear reason when the token budget is exceeded", async () => {
    const { task } = await makeTask("goal", { maxTokensPerTask: 1 });
    const provider = new ScriptedProvider([endTurn("a very long final answer that costs more than one token")]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [] });

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("FAILED");
    expect(finished.failureReason).toMatch(/token/i);
  });

  it("fails with a clear reason when the tool-call budget is exhausted", async () => {
    const { task } = await makeTask("goal", { maxToolCallsPerTask: 1 });
    const provider = new ScriptedProvider([
      toolUse("get_current_time", {}),
      toolUse("get_current_time", {}),
      endTurn("done"),
    ]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [getCurrentTimeTool] });

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("FAILED");
    expect(finished.failureReason).toMatch(/tool call/i);
    const executions = await prisma.toolExecution.findMany({ where: { taskId: task.id } });
    expect(executions).toHaveLength(1);
  });
});

describe("runAgentTask — cancellation", () => {
  it("does not start a task that was already cancelled before the worker picked it up", async () => {
    const { task } = await makeTask("goal");
    await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
    const provider = new ScriptedProvider([endTurn("should never be seen")]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [] });

    expect(provider.callCount).toBe(0);
    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("CANCELLED");
  });

  it("stops making further tool calls once cancelled mid-execution", async () => {
    const { task } = await makeTask("goal");
    const secondToolHandler = vi.fn(async () => ({ echoed: "should never run" }));
    const cancellingTool: ToolDefinition<Record<string, never>, { ok: boolean }> = {
      name: "cancel_during_run",
      description: "Cancels the task as a side effect, simulating a concurrent cancel request.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      inputJsonSchema: { type: "object", properties: {} },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 1000,
      async handler() {
        await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
        return { ok: true };
      },
    };
    const secondTool: ToolDefinition<Record<string, never>, { echoed: string }> = {
      ...echoTool,
      name: "second_tool",
      handler: secondToolHandler,
    };

    const provider = new ScriptedProvider([
      toolUse("cancel_during_run", {}),
      toolUse("second_tool", {}),
      endTurn("should never be reached"),
    ]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [cancellingTool, secondTool] });

    expect(provider.callCount).toBe(1);
    expect(secondToolHandler).not.toHaveBeenCalled();
    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("CANCELLED");
  });
});

describe("runAgentTask — retries", () => {
  it("retries a transiently failing tool call and succeeds", async () => {
    const { task } = await makeTask("goal", { maxRetriesPerToolCall: 2 });
    let attempts = 0;
    const flakyTool: ToolDefinition<Record<string, never>, { ok: boolean }> = {
      name: "flaky",
      description: "Fails twice, then succeeds.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      inputJsonSchema: { type: "object", properties: {} },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 1000,
      async handler() {
        attempts++;
        if (attempts < 3) {
          throw new Error(`transient failure #${attempts}`);
        }
        return { ok: true };
      },
    };
    const provider = new ScriptedProvider([toolUse("flaky", {}), endTurn("done")]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [flakyTool] });

    expect(attempts).toBe(3);
    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.status).toBe("SUCCEEDED");
    const retrySteps = await prisma.taskStep.findMany({ where: { taskId: task.id, kind: "RETRY" } });
    expect(retrySteps).toHaveLength(2);

    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("COMPLETED");
  });

  it("fails the tool call after exhausting retries", async () => {
    const { task } = await makeTask("goal", { maxRetriesPerToolCall: 1 });
    const alwaysFails: ToolDefinition<Record<string, never>, { ok: boolean }> = {
      name: "always_fails",
      description: "Always fails.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      inputJsonSchema: { type: "object", properties: {} },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 1000,
      async handler() {
        throw new Error("permanent failure");
      },
    };
    const provider = new ScriptedProvider([toolUse("always_fails", {}), endTurn("done")]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [alwaysFails] });

    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.status).toBe("FAILED");
    expect(execution.errorMessage).toContain("permanent failure");
    const retrySteps = await prisma.taskStep.findMany({ where: { taskId: task.id, kind: "RETRY" } });
    expect(retrySteps).toHaveLength(1);
  });
});
