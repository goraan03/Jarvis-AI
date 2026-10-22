import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import { registerScheduledTask } from "./register.js";
import type { ScheduledJobData } from "./types.js";

type SchedulerQueue = Pick<Queue<ScheduledJobData>, "upsertJobScheduler" | "removeJobScheduler" | "getJob" | "add" | "remove">;

/**
 * Re-registers every active ScheduledTask with BullMQ. Called on every
 * worker boot so Redis is never the sole source of truth for "what
 * should be scheduled" — if Redis was flushed or a repeatable job was
 * somehow lost, this restores it from Postgres. Safe to call repeatedly:
 * registerScheduledTask is idempotent — docs/architecture.md §8.
 */
export async function reconcileScheduledTasks(queue: SchedulerQueue): Promise<number> {
  const active = await prisma.scheduledTask.findMany({ where: { status: "active" } });
  for (const task of active) {
    await registerScheduledTask(queue, task);
  }
  return active.length;
}
