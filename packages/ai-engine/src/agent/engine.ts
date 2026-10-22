import { prisma } from "@jarvis/database";
import { hashApprovalInput } from "@jarvis/security";
import type { ModelMessage, ModelProvider, ToolCall } from "../types.js";
import type { ToolDefinition } from "../tools/types.js";
import { findTool, toToolSpecs } from "../tools/registry.js";
import { taskLimitsSchema } from "./limits.js";

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface RunAgentTaskDeps {
  modelProvider: ModelProvider;
  tools: ToolDefinition<any, any>[];
  /** Per-user tools that depend on DB state (e.g. "is Gmail connected?"),
   * resolved fresh for each task run rather than fixed at worker boot —
   * docs/implementation-roadmap.md Phase 5. */
  resolveDynamicTools?: (userId: string) => Promise<ToolDefinition<any, any>[]>;
}

interface PendingToolCall {
  toolCall: ToolCall;
  approvalRequestId?: string;
}

interface ConversationState {
  messages: ModelMessage[];
  pendingToolCalls: PendingToolCall[];
}

type ToolBatchResult =
  | { status: "completed" }
  | { status: "paused"; remaining: PendingToolCall[] }
  | { status: "cancelled" }
  | { status: "limit_exceeded"; reason: "tool_calls" };

async function getTaskStatus(taskId: string): Promise<string | null> {
  const row = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  return row?.status ?? null;
}

/**
 * Runs a task's execution lifecycle: plan → tool calls → verification →
 * report, enforcing every configured limit in code (not the prompt) and
 * persisting every step/tool call so nothing is ever reported "completed"
 * without a backing ToolExecution row — docs/architecture.md §4.
 *
 * Resumable: if a requested tool requires approval, the task pauses
 * (status AWAITING_APPROVAL) with its full in-progress state snapshotted
 * to Task.conversationState. Calling runAgentTask again later (triggered
 * by an approval decision re-enqueuing the job) picks up exactly where it
 * left off instead of restarting — docs/security-model.md §5.
 */
export async function runAgentTask(taskId: string, deps: RunAgentTaskDeps): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { conversation: true } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  if (task.status === "CANCELLED") {
    return;
  }

  const userId = task.userId;
  const limits = taskLimitsSchema.parse(task.limits);
  const dynamicTools = (await deps.resolveDynamicTools?.(userId)) ?? [];
  const allTools = [...deps.tools, ...dynamicTools];
  const toolSpecs = toToolSpecs(allTools);
  const requestedVia = task.conversation?.channel ?? "WEB";

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "RUNNING", startedAt: task.startedAt ?? new Date() },
  });

  const startedAtMs = (task.startedAt ?? new Date()).getTime();

  const initialState: ConversationState = task.conversationState
    ? (task.conversationState as unknown as ConversationState)
    : { messages: [{ role: "user", content: task.goal }], pendingToolCalls: [] };
  const messages: ModelMessage[] = initialState.messages;
  let pendingToolCalls: PendingToolCall[] = initialState.pendingToolCalls;

  // Limits are enforced cumulatively across resumes by re-deriving counts
  // from what's actually persisted, rather than trusting in-memory state
  // that wouldn't survive a pause/restart.
  let toolCallCount = await prisma.toolExecution.count({ where: { taskId } });
  let modelCallCount = await prisma.usageRecord.count({ where: { taskId } });
  const tokenAgg = await prisma.usageRecord.aggregate({
    where: { taskId },
    _sum: { inputTokens: true, outputTokens: true },
  });
  let totalTokens = (tokenAgg._sum.inputTokens ?? 0) + (tokenAgg._sum.outputTokens ?? 0);

  let stepIndex = await prisma.taskStep.count({ where: { taskId } });
  const recordStep = (
    kind: "MODEL_TURN" | "TOOL_CALL_REQUESTED" | "APPROVAL_REQUESTED" | "RETRY" | "LIMIT_EXCEEDED",
    detail: unknown,
  ) => prisma.taskStep.create({ data: { taskId, stepIndex: stepIndex++, kind, detail: detail as any } });

  const finishTask = (status: "COMPLETED" | "FAILED", data: { resultSummary?: string; failureReason?: string }) =>
    prisma.task.update({ where: { id: taskId }, data: { status, completedAt: new Date(), ...data } });

  const persistState = (pending: PendingToolCall[]) =>
    prisma.task.update({
      where: { id: taskId },
      data: { conversationState: { messages, pendingToolCalls: pending } as any },
    });

  async function processToolCalls(initial: PendingToolCall[]): Promise<ToolBatchResult> {
    const remaining = [...initial];

    while (remaining.length > 0) {
      if ((await getTaskStatus(taskId)) === "CANCELLED") {
        return { status: "cancelled" };
      }
      if (toolCallCount >= limits.maxToolCallsPerTask) {
        return { status: "limit_exceeded", reason: "tool_calls" };
      }

      const entry = remaining[0];
      const { toolCall } = entry;
      const tool = findTool(allTools, toolCall.name);

      if (!tool) {
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: `Error: tool "${toolCall.name}" is not registered.`,
          isError: true,
        });
        remaining.shift();
        continue;
      }

      const parsedInput = tool.inputSchema.safeParse(toolCall.input);
      if (!parsedInput.success) {
        toolCallCount++;
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
        remaining.shift();
        continue;
      }

      if (tool.requiresApproval) {
        if (!entry.approvalRequestId) {
          const approval = await prisma.approvalRequest.create({
            data: {
              userId,
              taskId,
              toolName: tool.name,
              boundInput: parsedInput.data as any,
              inputHash: hashApprovalInput(parsedInput.data),
              requestedVia,
              expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
            },
          });
          await recordStep("APPROVAL_REQUESTED", { toolName: tool.name, approvalRequestId: approval.id });
          remaining[0] = { ...entry, approvalRequestId: approval.id };
          return { status: "paused", remaining };
        }

        const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: entry.approvalRequestId } });
        const isExpired = approval.status === "PENDING" && approval.expiresAt < new Date();
        if (isExpired) {
          await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: "EXPIRED" } });
        }
        const effectiveStatus = isExpired ? "EXPIRED" : approval.status;

        if (effectiveStatus === "PENDING") {
          // Resumed before a decision was actually made — re-pause.
          return { status: "paused", remaining };
        }

        toolCallCount++;
        const inputStillMatches = effectiveStatus === "APPROVED" && approval.inputHash === hashApprovalInput(parsedInput.data);

        if (!inputStillMatches) {
          const reason =
            effectiveStatus === "APPROVED"
              ? "Approval no longer matches the requested action; a fresh approval is required."
              : `This action was not approved (${effectiveStatus.toLowerCase()}).`;
          await prisma.toolExecution.create({
            data: {
              taskId,
              toolName: tool.name,
              input: parsedInput.data as any,
              status: "BLOCKED_APPROVAL",
              errorMessage: reason,
              riskLevel: tool.riskLevel,
              completedAt: new Date(),
            },
          });
          messages.push({ role: "tool", toolCallId: toolCall.id, name: tool.name, content: `Error: ${reason}`, isError: true });
          remaining.shift();
          continue;
        }

        await executeAndRecord(tool, parsedInput.data, toolCall);
        remaining.shift();
        continue;
      }

      // Ordinary tool, no approval needed.
      toolCallCount++;
      await executeAndRecord(tool, parsedInput.data, toolCall);
      remaining.shift();
    }

    return { status: "completed" };
  }

  async function executeAndRecord(tool: ToolDefinition<any, any>, input: unknown, toolCall: ToolCall): Promise<void> {
    const execution = await executeToolWithRetries(tool, input, userId, taskId, limits.maxRetriesPerToolCall, recordStep);
    const toolExecution = await prisma.toolExecution.create({
      data: {
        taskId,
        toolName: tool.name,
        input: input as any,
        output: execution.success ? (execution.output as any) : undefined,
        status: execution.success ? "SUCCEEDED" : "FAILED",
        errorMessage: execution.success ? undefined : execution.errorMessage,
        riskLevel: tool.riskLevel,
        durationMs: execution.durationMs,
        completedAt: new Date(),
      },
    });
    // Successful results carry their own ToolExecution id so a later
    // generate_research_report call can cite exactly which real tool
    // call backs each claim — docs/implementation-roadmap.md Phase 7.
    // Failures aren't worth citing, so their message format is
    // unchanged (plain "Error: ..." text).
    messages.push({
      role: "tool",
      toolCallId: toolCall.id,
      name: tool.name,
      content: execution.success
        ? JSON.stringify({ toolExecutionId: toolExecution.id, result: execution.output })
        : `Error: ${execution.errorMessage}`,
      isError: !execution.success,
    });
  }

  // Resume path: finish any tool calls left over from before a pause.
  if (pendingToolCalls.length > 0) {
    const result = await processToolCalls(pendingToolCalls);
    if (result.status === "cancelled") return;
    if (result.status === "paused") {
      await persistState(result.remaining);
      await prisma.task.update({ where: { id: taskId }, data: { status: "AWAITING_APPROVAL" } });
      return;
    }
    if (result.status === "limit_exceeded") {
      await recordStep("LIMIT_EXCEEDED", { reason: result.reason, toolCallCount });
      await finishTask("FAILED", { failureReason: "Task exceeded its maximum tool call budget." });
      return;
    }
    pendingToolCalls = [];
    await persistState([]);
  }

  while (modelCallCount < limits.maxModelCallsPerTask) {
    if ((await getTaskStatus(taskId)) === "CANCELLED") {
      return;
    }
    if (Date.now() - startedAtMs > limits.maxTaskDurationMs) {
      await recordStep("LIMIT_EXCEEDED", { reason: "duration", elapsedMs: Date.now() - startedAtMs });
      await finishTask("FAILED", { failureReason: "Task exceeded its maximum execution duration." });
      return;
    }

    const result = await deps.modelProvider.complete({ model: limits.model, messages, tools: toolSpecs });
    modelCallCount++;

    await prisma.usageRecord.create({
      data: {
        userId,
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

    const batchResult = await processToolCalls(result.toolCalls.map((toolCall) => ({ toolCall })));
    if (batchResult.status === "cancelled") return;
    if (batchResult.status === "paused") {
      await persistState(batchResult.remaining);
      await prisma.task.update({ where: { id: taskId }, data: { status: "AWAITING_APPROVAL" } });
      return;
    }
    if (batchResult.status === "limit_exceeded") {
      await recordStep("LIMIT_EXCEEDED", { reason: batchResult.reason, toolCallCount });
      await finishTask("FAILED", { failureReason: "Task exceeded its maximum tool call budget." });
      return;
    }

    await persistState([]);
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
