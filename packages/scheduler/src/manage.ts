import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import { registerScheduledTask, unregisterScheduledTask } from "./register.js";
import type { ScheduledJobData } from "./types.js";

type SchedulerQueue = Pick<Queue<ScheduledJobData>, "upsertJobScheduler" | "removeJobScheduler" | "getJob" | "add" | "remove">;

export class ScheduledTaskNotFoundError extends Error {
  constructor() {
    super("Scheduled task not found.");
    this.name = "ScheduledTaskNotFoundError";
  }
}

export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleError";
  }
}

export interface CreateScheduledTaskParams {
  userId: string;
  name: string;
  timezone: string;
  payload: { goal: string };
  cronExpression?: string;
  runAt?: Date;
}

function validateSchedule(cronExpression: string | undefined, runAt: Date | undefined): void {
  if (!cronExpression && !runAt) {
    throw new InvalidScheduleError("Provide either cronExpression or runAt.");
  }
  if (cronExpression && runAt) {
    throw new InvalidScheduleError("Provide only one of cronExpression or runAt, not both.");
  }
}

export async function createScheduledTask(queue: SchedulerQueue, params: CreateScheduledTaskParams) {
  validateSchedule(params.cronExpression, params.runAt);

  const scheduledTask = await prisma.scheduledTask.create({
    data: {
      userId: params.userId,
      name: params.name,
      timezone: params.timezone,
      payload: params.payload,
      cronExpression: params.cronExpression,
      runAt: params.runAt,
      status: "active",
      bullSchedulerId: null,
    },
  });

  await registerScheduledTask(queue, scheduledTask);
  return prisma.scheduledTask.update({ where: { id: scheduledTask.id }, data: { bullSchedulerId: scheduledTask.id } });
}

async function findOwned(scheduledTaskId: string, userId: string) {
  const task = await prisma.scheduledTask.findFirst({ where: { id: scheduledTaskId, userId } });
  if (!task) throw new ScheduledTaskNotFoundError();
  return task;
}

export async function pauseScheduledTask(queue: SchedulerQueue, scheduledTaskId: string, userId: string) {
  const task = await findOwned(scheduledTaskId, userId);
  await unregisterScheduledTask(queue, task);
  return prisma.scheduledTask.update({ where: { id: task.id }, data: { status: "paused" } });
}

export async function resumeScheduledTask(queue: SchedulerQueue, scheduledTaskId: string, userId: string) {
  const task = await findOwned(scheduledTaskId, userId);
  const resumed = await prisma.scheduledTask.update({ where: { id: task.id }, data: { status: "active" } });
  await registerScheduledTask(queue, resumed);
  return resumed;
}

export async function cancelScheduledTask(queue: SchedulerQueue, scheduledTaskId: string, userId: string) {
  const task = await findOwned(scheduledTaskId, userId);
  await unregisterScheduledTask(queue, task);
  return prisma.scheduledTask.update({ where: { id: task.id }, data: { status: "cancelled" } });
}

export interface UpdateScheduledTaskParams {
  name?: string;
  timezone?: string;
  payload?: { goal: string };
  cronExpression?: string | null;
  runAt?: Date | null;
}

export async function updateScheduledTask(
  queue: SchedulerQueue,
  scheduledTaskId: string,
  userId: string,
  params: UpdateScheduledTaskParams,
) {
  const task = await findOwned(scheduledTaskId, userId);

  const nextCron = params.cronExpression !== undefined ? params.cronExpression : task.cronExpression;
  const nextRunAt = params.runAt !== undefined ? params.runAt : task.runAt;
  validateSchedule(nextCron ?? undefined, nextRunAt ?? undefined);

  if (task.status === "active") {
    await unregisterScheduledTask(queue, task);
  }

  const updated = await prisma.scheduledTask.update({
    where: { id: task.id },
    data: {
      name: params.name,
      timezone: params.timezone,
      payload: params.payload,
      cronExpression: nextCron,
      runAt: nextRunAt,
    },
  });

  if (updated.status === "active") {
    await registerScheduledTask(queue, updated);
  }
  return updated;
}

/** Fires the schedule immediately, going through the same idempotent job
 * processor as a real scheduled occurrence — used for "run now" in the
 * UI and exercised directly by this phase's duplicate-trigger test. */
export async function triggerScheduledTaskNow(queue: SchedulerQueue, scheduledTaskId: string, userId: string) {
  await findOwned(scheduledTaskId, userId);
  await queue.add("run", { scheduledTaskId });
}
