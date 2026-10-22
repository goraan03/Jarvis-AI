import type { Queue } from "bullmq";
import { prisma, Prisma } from "@jarvis/database";
import { createAndEnqueueTask, ConcurrentTaskLimitError, type AgentTaskJobData } from "@jarvis/ai-engine";

export interface SchedulerRunnerDeps {
  agentTaskQueue: Pick<Queue<AgentTaskJobData>, "add">;
  /** Optional: resolve a Telegram conversation to attach to the created
   * task, so success/failure notifications reuse the existing
   * notifyTaskResult hook without any new wiring. */
  getNotificationConversationId?: (userId: string) => Promise<string | null>;
}

function currentWindowKey(): string {
  // Minute resolution: two triggers within the same minute (e.g. a
  // double-click on "run now") collide on the unique index below and
  // the second is a no-op; distinct scheduled occurrences a minute or
  // more apart are unaffected.
  return new Date().toISOString().slice(0, 16);
}

/**
 * The BullMQ job handler body for the scheduled-jobs queue. Idempotent:
 * a redelivered/duplicate firing within the same minute creates no
 * second ScheduledTaskRun and no second agent Task —
 * docs/implementation-roadmap.md Phase 6 gate.
 */
export async function runScheduledTaskJob(scheduledTaskId: string, deps: SchedulerRunnerDeps): Promise<void> {
  const scheduledTask = await prisma.scheduledTask.findUnique({ where: { id: scheduledTaskId } });
  if (!scheduledTask || scheduledTask.status !== "active") {
    return; // paused/cancelled/deleted since this job was scheduled — stale fire, no-op
  }

  const idempotencyKey = `${scheduledTaskId}:${currentWindowKey()}`;
  let run;
  try {
    run = await prisma.scheduledTaskRun.create({ data: { scheduledTaskId, idempotencyKey, status: "created" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return; // already handled this firing — no-op, by design
    }
    throw error;
  }

  const payload = scheduledTask.payload as { goal: string };
  const conversationId = (await deps.getNotificationConversationId?.(scheduledTask.userId)) ?? undefined;

  try {
    const task = await createAndEnqueueTask(deps.agentTaskQueue, {
      userId: scheduledTask.userId,
      goal: payload.goal,
      conversationId,
    });
    await prisma.scheduledTaskRun.update({ where: { id: run.id }, data: { taskId: task.id } });
    await prisma.scheduledTask.update({ where: { id: scheduledTaskId }, data: { lastRunAt: new Date(), lastStatus: "created" } });
  } catch (error) {
    const status = error instanceof ConcurrentTaskLimitError ? "skipped_concurrency_limit" : "failed";
    await prisma.scheduledTaskRun.update({ where: { id: run.id }, data: { status } });
    await prisma.scheduledTask.update({ where: { id: scheduledTaskId }, data: { lastRunAt: new Date(), lastStatus: status } });
  }
}
