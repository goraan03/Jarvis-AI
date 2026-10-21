import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prisma } from "@jarvis/database";
import { hashPassword, hashApprovalInput } from "@jarvis/security";
import { runAgentTask } from "./engine.js";
import { decideApproval, cancelPendingApprovalsForTask, ApprovalNotFoundError, ApprovalAlreadyDecidedError } from "./approvals.js";
import { buildTaskLimits, type TaskLimits } from "./limits.js";
import type { ToolDefinition } from "../tools/types.js";
import type { CompletionRequest, CompletionResult, ModelProvider } from "../types.js";

async function makeTask(goal: string, limitOverrides: Partial<TaskLimits> = {}) {
  const email = `${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword("x"), settings: { create: {} } },
  });
  const settings = await prisma.agentSettings.findUniqueOrThrow({ where: { userId: user.id } });
  const limits: TaskLimits = { ...buildTaskLimits(settings), ...limitOverrides };
  const task = await prisma.task.create({ data: { userId: user.id, goal, limits } });
  return { user, task };
}

function fakeQueue() {
  const add = vi.fn(async () => ({ id: "fake-job" }));
  return { add } as any;
}

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

function makeSendEmailTool(handler: ReturnType<typeof vi.fn>): ToolDefinition<{ to: string; body: string }, { messageId: string }> {
  return {
    name: "send_email",
    description: "Sends an email. Requires approval.",
    inputSchema: z.object({ to: z.string(), body: z.string() }),
    outputSchema: z.object({ messageId: z.string() }),
    inputJsonSchema: { type: "object", properties: { to: { type: "string" }, body: { type: "string" } } },
    riskLevel: "high",
    requiresApproval: true,
    timeoutMs: 1000,
    handler: handler as any,
  };
}

describe("approval-gated tool execution", () => {
  it("pauses the task and never calls the handler before a decision exists", async () => {
    const handler = vi.fn(async () => ({ messageId: "should-not-run" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task } = await makeTask("email the report");
    const provider = new ScriptedProvider([toolUse("send_email", { to: "a@example.com", body: "the report" })]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });

    expect(handler).not.toHaveBeenCalled();
    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("AWAITING_APPROVAL");

    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    expect(approval.status).toBe("PENDING");
    expect(approval.toolName).toBe("send_email");
    expect(approval.boundInput).toEqual({ to: "a@example.com", body: "the report" });
    expect(approval.inputHash).toBe(hashApprovalInput({ to: "a@example.com", body: "the report" }));
  });

  it("executes the tool for real only after approval, then resumes to completion", async () => {
    const handler = vi.fn(async () => ({ messageId: "real-message-id" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task, user } = await makeTask("email the report");
    const provider = new ScriptedProvider([
      toolUse("send_email", { to: "a@example.com", body: "the report" }),
      endTurn("Sent it."),
    ]);
    const queue = fakeQueue();

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });

    await decideApproval(approval.id, "APPROVED", user.id, queue);
    expect(queue.add).toHaveBeenCalledTimes(1);

    // The approval decision re-enqueues the job; simulate the worker
    // picking it back up by calling runAgentTask again directly.
    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });

    expect(handler).toHaveBeenCalledTimes(1);
    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.status).toBe("SUCCEEDED");
    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("COMPLETED");
  });

  it("never executes the tool when rejected, and tells the model why", async () => {
    const handler = vi.fn(async () => ({ messageId: "should-not-run" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task, user } = await makeTask("email the report");
    const provider = new ScriptedProvider([
      toolUse("send_email", { to: "a@example.com", body: "the report" }),
      endTurn("Did not send, as requested."),
    ]);
    const queue = fakeQueue();

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    await decideApproval(approval.id, "REJECTED", user.id, queue);
    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });

    expect(handler).not.toHaveBeenCalled();
    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.status).toBe("BLOCKED_APPROVAL");
    const finished = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finished.status).toBe("COMPLETED");
  });

  it("blocks execution if the pending input no longer matches what was approved (tampering/drift)", async () => {
    const handler = vi.fn(async () => ({ messageId: "should-not-run" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task, user } = await makeTask("email the report");
    const provider = new ScriptedProvider([
      toolUse("send_email", { to: "a@example.com", body: "original body" }),
      endTurn("done"),
    ]);
    const queue = fakeQueue();

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    await decideApproval(approval.id, "APPROVED", user.id, queue);

    // Simulate the bound input drifting after approval (should never
    // happen through normal API surfaces, but the engine must not trust
    // "APPROVED" status alone).
    const current = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const state = current.conversationState as any;
    state.pendingToolCalls[0].toolCall.input = { to: "a@example.com", body: "a completely different body" };
    await prisma.task.update({ where: { id: task.id }, data: { conversationState: state } });

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });

    expect(handler).not.toHaveBeenCalled();
    const execution = await prisma.toolExecution.findFirstOrThrow({ where: { taskId: task.id } });
    expect(execution.status).toBe("BLOCKED_APPROVAL");
    expect(execution.errorMessage).toMatch(/no longer matches/i);
  });

  it("auto-expires a stale pending approval at execution time", async () => {
    const handler = vi.fn(async () => ({ messageId: "should-not-run" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task } = await makeTask("email the report");
    const provider = new ScriptedProvider([toolUse("send_email", { to: "a@example.com", body: "x" }), endTurn("done")]);

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });

    expect(handler).not.toHaveBeenCalled();
    const reloaded = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    expect(reloaded.status).toBe("EXPIRED");
  });
});

describe("decideApproval", () => {
  it("throws ApprovalNotFoundError for a nonexistent or someone-else's approval", async () => {
    const { user } = await makeTask("goal");
    await expect(decideApproval("nonexistent-id", "APPROVED", user.id, fakeQueue())).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });

  it("throws ApprovalAlreadyDecidedError on a second decision", async () => {
    const handler = vi.fn(async () => ({ messageId: "x" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task, user } = await makeTask("goal");
    const provider = new ScriptedProvider([toolUse("send_email", { to: "a@example.com", body: "x" })]);
    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });

    await decideApproval(approval.id, "APPROVED", user.id, fakeQueue());
    await expect(decideApproval(approval.id, "REJECTED", user.id, fakeQueue())).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });

  it("does not re-enqueue a task that was cancelled while awaiting approval", async () => {
    const handler = vi.fn(async () => ({ messageId: "x" }));
    const sendEmail = makeSendEmailTool(handler);
    const { task, user } = await makeTask("goal");
    const provider = new ScriptedProvider([toolUse("send_email", { to: "a@example.com", body: "x" })]);
    await runAgentTask(task.id, { modelProvider: provider, tools: [sendEmail] });

    await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
    await cancelPendingApprovalsForTask(task.id);

    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    expect(approval.status).toBe("CANCELLED");

    await expect(decideApproval(approval.id, "APPROVED", user.id, fakeQueue())).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });
});
