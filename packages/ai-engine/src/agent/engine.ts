import { prisma } from "@jarvis/database";
import type { ModelMessage, ModelProvider } from "../types.js";
import type { ToolDefinition } from "../tools/types.js";
import { findTool, toToolSpecs } from "../tools/registry.js";
import { taskLimitsSchema } from "./limits.js";

export interface RunAgentTaskDeps {
  modelProvider: ModelProvider;
  tools: ToolDefinition<any, any>[];
}

async function getTaskStatus(taskId: string): Promise<string | null> {
  const row = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  return row?.status ?? null;
}

/**
 * Runs a task's full execution lifecycle to completion: plan → tool
 * calls → verification → report, enforcing every configured limit in
 * code (not the prompt) and persisting every step/tool call so nothing
 * is ever reported "completed" without a backing ToolExecution row —
 * docs/architecture.md §4. Safe to call from a BullMQ job handler or
 * directly (as Phase 3's tests do).
 */
export async function runAgentTask(taskId: string, deps: RunAgentTaskDeps): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  if (task.status === "CANCELLED") {
    return;
  }

  const limits = taskLimitsSchema.parse(task.limits);

  await prisma.task.update({ where: { id: taskId }, data: { status: "RUNNING", startedAt: new Date() } });

  const startedAtMs = Date.now();
  const toolSpecs = toToolSpecs(deps.tools);
  const messages: ModelMessage[] = [{ role: "user", content: task.goal }];

  let stepIndex = 0;
  const recordStep = (kind: "MODEL_TURN" | "TOOL_CALL_REQUESTED" | "RETRY" | "LIMIT_EXCEEDED", detail: unknown) =>
    prisma.taskStep.create({ data: { taskId, stepIndex: stepIndex++, kind, detail: detail as any } });

  const finishTask = (status: "COMPLETED" | "FAILED", data: { resultSummary?: string; failureReason?: string }) =>
    prisma.task.update({ where: { id: taskId }, data: { status, completedAt: new Date(), ...data } });

  let toolCallCount = 0;
  let totalTokens = 0;

  for (let modelCallIndex = 0; modelCallIndex < limits.maxModelCallsPerTask; modelCallIndex++) {
    if ((await getTaskStatus(taskId)) === "CANCELLED") {
      return;
    }

    if (Date.now() - startedAtMs > limits.maxTaskDurationMs) {
      await recordStep("LIMIT_EXCEEDED", { reason: "duration", elapsedMs: Date.now() - startedAtMs });
      await finishTask("FAILED", { failureReason: "Task exceeded its maximum execution duration." });
      return;
    }

    const result = await deps.modelProvider.complete({ model: limits.model, messages, tools: toolSpecs });

    await prisma.usageRecord.create({
      data: {
        userId: task.userId,
        taskId,
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        // No real pricing table exists yet — only the mock provider runs today.
        estimatedCostMicroUsd: 0,
      },
    });
    totalTokens += result.usage.inputTokens + result.usage.outputTokens;

    await recordStep("MODEL_TURN", {
      stopReason: result.stopReason,
      content: result.content,
      toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
    });

    if (totalTokens > limits.maxTokensPerTask) {
      await recordStep("LIMIT_EXCEEDED", { reason: "tokens", totalTokens });
      await finishTask("FAILED", { failureReason: "Task exceeded its maximum token budget." });
      return;
    }

    if (result.stopReason === "end_turn") {
      await finishTask("COMPLETED", { resultSummary: result.content });
      return;
    }

    messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });

    for (const toolCall of result.toolCalls) {
      if ((await getTaskStatus(taskId)) === "CANCELLED") {
        return;
      }

      if (toolCallCount >= limits.maxToolCallsPerTask) {
        await recordStep("LIMIT_EXCEEDED", { reason: "tool_calls", toolCallCount });
        await finishTask("FAILED", { failureReason: "Task exceeded its maximum tool call budget." });
        return;
      }

      const tool = findTool(deps.tools, toolCall.name);
      if (!tool) {
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: `Error: tool "${toolCall.name}" is not registered.`,
          isError: true,
        });
        continue;
      }

      const parsedInput = tool.inputSchema.safeParse(toolCall.input);
      toolCallCount++;

      if (!parsedInput.success) {
        await prisma.toolExecution.create({
          data: {
            taskId,
            toolName: tool.name,
            input: (toolCall.input ?? {}) as any,
            status: "FAILED",
            errorMessage: `Invalid input: ${parsedInput.error.message}`,
            riskLevel: tool.riskLevel,
            completedAt: new Date(),
          },
        });
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: tool.name,
          content: `Error: invalid input — ${parsedInput.error.message}`,
          isError: true,
        });
        continue;
      }

      if (tool.requiresApproval) {
        await prisma.toolExecution.create({
          data: {
            taskId,
            toolName: tool.name,
            input: parsedInput.data as any,
            status: "BLOCKED_APPROVAL",
            riskLevel: tool.riskLevel,
            completedAt: new Date(),
          },
        });
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: tool.name,
          content: "Error: this tool requires approval, which is not implemented yet.",
          isError: true,
        });
        continue;
      }

      const execution = await executeToolWithRetries(tool, parsedInput.data, task.userId, taskId, limits.maxRetriesPerToolCall, recordStep);

      await prisma.toolExecution.create({
        data: {
          taskId,
          toolName: tool.name,
          input: parsedInput.data as any,
          output: execution.success ? (execution.output as any) : undefined,
          status: execution.success ? "SUCCEEDED" : "FAILED",
          errorMessage: execution.success ? undefined : execution.errorMessage,
          riskLevel: tool.riskLevel,
          durationMs: execution.durationMs,
          completedAt: new Date(),
        },
      });

      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: tool.name,
        content: execution.success ? JSON.stringify(execution.output) : `Error: ${execution.errorMessage}`,
        isError: !execution.success,
      });
    }
  }

  await recordStep("LIMIT_EXCEEDED", { reason: "model_calls" });
  await finishTask("FAILED", { failureReason: "Task exceeded its maximum model call budget without finishing." });
}

interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  errorMessage?: string;
  durationMs: number;
}

async function executeToolWithRetries(
  tool: ToolDefinition<any, any>,
  input: unknown,
  userId: string,
  taskId: string,
  maxRetries: number,
  recordStep: (kind: "RETRY", detail: unknown) => Promise<unknown>,
): Promise<ToolExecutionResult> {
  const start = Date.now();
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      const output = await runWithTimeout(tool.handler(input, { userId, taskId }), tool.timeoutMs);
      const parsedOutput = tool.outputSchema.safeParse(output);
      return {
        success: true,
        output: parsedOutput.success ? parsedOutput.data : output,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      lastError = error;
      attempt++;
      if (attempt <= maxRetries) {
        await recordStep("RETRY", {
          toolName: tool.name,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    success: false,
    errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
    durationMs: Date.now() - start,
  };
}

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Tool call timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
