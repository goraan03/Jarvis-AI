import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import { buildTaskLimits } from "./limits.js";
import { enqueueAgentTask, type AgentTaskJobData } from "../queue.js";

const ACTIVE_STATUSES = ["PENDING", "PLANNING", "RUNNING", "AWAITING_APPROVAL"] as const;

export class ConcurrentTaskLimitError extends Error {
  constructor(
    public activeCount: number,
    public limit: number,
  ) {
    super(`You already have ${activeCount} active task(s); the configured limit is ${limit}.`);
    this.name = "ConcurrentTaskLimitError";
  }
}

export class SettingsNotFoundError extends Error {
  constructor(userId: string) {
    super(`No AgentSettings found for user ${userId}.`);
    this.name = "SettingsNotFoundError";
  }
}

/**
 * Shared by every channel that can create tasks (web API, Telegram, and
 * later the scheduler) so the concurrency limit and limits snapshot are
 * enforced identically everywhere, not re-implemented per channel.
 */
export async function createAndEnqueueTask(
  queue: Pick<Queue<AgentTaskJobData>, "add">,
  params: { userId: string; goal: string; conversationId?: string },
) {
  const settings = await prisma.agentSettings.findUnique({ where: { userId: params.userId } });
  if (!settings) {
    throw new SettingsNotFoundError(params.userId);
  }

  const activeCount = await prisma.task.count({
    where: { userId: params.userId, status: { in: [...ACTIVE_STATUSES] } },
  });
  if (activeCount >= settings.maxConcurrentTasks) {
    throw new ConcurrentTaskLimitError(activeCount, settings.maxConcurrentTasks);
  }

  const limits = buildTaskLimits(settings);
  const task = await prisma.task.create({
    data: { userId: params.userId, goal: params.goal, conversationId: params.conversationId, limits },
  });
  await enqueueAgentTask(queue, task.id);
  return task;
}
