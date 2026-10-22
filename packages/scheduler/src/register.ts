import type { Queue } from "bullmq";
import type { ScheduledTask } from "@jarvis/database";
import type { ScheduledJobData } from "./types.js";

type SchedulerQueue = Pick<Queue<ScheduledJobData>, "upsertJobScheduler" | "removeJobScheduler" | "getJob" | "add" | "remove">;

/**
 * Registers (or re-registers) a ScheduledTask with BullMQ. Idempotent by
 * construction: upsertJobScheduler never duplicates a recurring
 * schedule, and a one-time job is only added if one with this id isn't
 * already queued — both safe to call again on every worker boot
 * (docs/implementation-roadmap.md Phase 6 gate: "restart apps/worker
 * mid-schedule and confirm the next occurrence still fires").
 */
export async function registerScheduledTask(queue: SchedulerQueue, task: ScheduledTask): Promise<void> {
  if (task.cronExpression) {
    await queue.upsertJobScheduler(
      task.id,
      { pattern: task.cronExpression, tz: task.timezone },
      { name: "run", data: { scheduledTaskId: task.id } },
    );
    return;
  }

  if (task.runAt) {
    const existing = await queue.getJob(task.id);
    if (existing) return;
    const delay = Math.max(0, task.runAt.getTime() - Date.now());
    await queue.add("run", { scheduledTaskId: task.id }, { jobId: task.id, delay });
  }
}

export async function unregisterScheduledTask(queue: SchedulerQueue, task: ScheduledTask): Promise<void> {
  if (task.cronExpression) {
    await queue.removeJobScheduler(task.id);
    return;
  }
  if (task.runAt) {
    await queue.remove(task.id).catch(() => undefined); // may have already fired/been removed
  }
}
