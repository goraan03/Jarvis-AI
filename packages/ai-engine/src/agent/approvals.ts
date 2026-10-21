import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import { enqueueAgentTask, type AgentTaskJobData } from "../queue.js";

const TERMINAL_TASK_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

export class ApprovalNotFoundError extends Error {
  constructor() {
    super("Approval request not found.");
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor(status: string) {
    super(`This approval has already been decided (${status}).`);
    this.name = "ApprovalAlreadyDecidedError";
  }
}

/**
 * Approves or rejects a pending ApprovalRequest and, if the owning task
 * is still active, re-enqueues it so the agent engine resumes exactly
 * where it paused. Shared by the HTTP approvals route and the Telegram
 * callback-button handler so both enforce identical rules —
 * docs/security-model.md §5.
 */
export async function decideApproval(
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  userId: string,
  taskQueue: Pick<Queue<AgentTaskJobData>, "add">,
) {
  const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, userId } });
  if (!approval) {
    throw new ApprovalNotFoundError();
  }

  if (approval.status === "PENDING" && approval.expiresAt < new Date()) {
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: "EXPIRED" } });
    throw new ApprovalAlreadyDecidedError("EXPIRED");
  }
  if (approval.status !== "PENDING") {
    throw new ApprovalAlreadyDecidedError(approval.status);
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: { status: decision, decidedAt: new Date() },
  });

  const task = await prisma.task.findUnique({ where: { id: approval.taskId } });
  if (task && !(TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    await enqueueAgentTask(taskQueue, task.id);
  }

  return updated;
}

/** Called when a task is cancelled while one of its tool calls is still
 * awaiting a decision — the approval shouldn't linger as actionable. */
export async function cancelPendingApprovalsForTask(taskId: string): Promise<void> {
  await prisma.approvalRequest.updateMany({
    where: { taskId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
}
