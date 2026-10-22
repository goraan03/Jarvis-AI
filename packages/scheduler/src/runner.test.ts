import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@jarvis/database";
import { runScheduledTaskJob } from "./runner.js";

async function makeUser(maxConcurrentTasks = 2) {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({
    data: { email, passwordHash: "x", settings: { create: { maxConcurrentTasks } } },
  });
}

async function makeActiveSchedule(userId: string, goal = "do the thing") {
  return prisma.scheduledTask.create({
    data: { userId, name: "test", timezone: "UTC", payload: { goal }, status: "active", cronExpression: "0 8 * * *" },
  });
}

function fakeAgentQueue() {
  const add = vi.fn(async () => ({}) as any);
  return { add };
}

describe("runScheduledTaskJob", () => {
  it("creates a real agent task and records a run on first firing", async () => {
    const user = await makeUser();
    const schedule = await makeActiveSchedule(user.id);
    const agentTaskQueue = fakeAgentQueue();

    await runScheduledTaskJob(schedule.id, { agentTaskQueue });

    expect(agentTaskQueue.add).toHaveBeenCalledTimes(1);
    const runs = await prisma.scheduledTaskRun.findMany({ where: { scheduledTaskId: schedule.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("created");
    expect(runs[0].taskId).toBeTruthy();

    const reloaded = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(reloaded.lastStatus).toBe("created");
    expect(reloaded.lastRunAt).toBeTruthy();
  });

  it("two triggers close together create exactly one task and one run (idempotency gate)", async () => {
    const user = await makeUser();
    const schedule = await makeActiveSchedule(user.id);
    const agentTaskQueue = fakeAgentQueue();

    await Promise.all([
      runScheduledTaskJob(schedule.id, { agentTaskQueue }),
      runScheduledTaskJob(schedule.id, { agentTaskQueue }),
    ]);

    expect(agentTaskQueue.add).toHaveBeenCalledTimes(1);
    const runs = await prisma.scheduledTaskRun.findMany({ where: { scheduledTaskId: schedule.id } });
    expect(runs).toHaveLength(1);
    const tasks = await prisma.task.findMany({ where: { userId: user.id } });
    expect(tasks).toHaveLength(1);
  });

  it("does nothing for a paused schedule (stale fire)", async () => {
    const user = await makeUser();
    const schedule = await makeActiveSchedule(user.id);
    await prisma.scheduledTask.update({ where: { id: schedule.id }, data: { status: "paused" } });
    const agentTaskQueue = fakeAgentQueue();

    await runScheduledTaskJob(schedule.id, { agentTaskQueue });

    expect(agentTaskQueue.add).not.toHaveBeenCalled();
    const runs = await prisma.scheduledTaskRun.findMany({ where: { scheduledTaskId: schedule.id } });
    expect(runs).toHaveLength(0);
  });

  it("records skipped_concurrency_limit without throwing when the user is at their task limit", async () => {
    const user = await makeUser(0); // zero active tasks allowed
    const schedule = await makeActiveSchedule(user.id);
    const agentTaskQueue = fakeAgentQueue();

    await runScheduledTaskJob(schedule.id, { agentTaskQueue });

    const runs = await prisma.scheduledTaskRun.findMany({ where: { scheduledTaskId: schedule.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("skipped_concurrency_limit");
    expect(agentTaskQueue.add).not.toHaveBeenCalled();
  });

  it("attaches the user's Telegram conversation when getNotificationConversationId resolves one", async () => {
    const user = await makeUser();
    const schedule = await makeActiveSchedule(user.id);
    const agentTaskQueue = fakeAgentQueue();
    const conversation = await prisma.conversation.create({ data: { userId: user.id, channel: "TELEGRAM" } });

    await runScheduledTaskJob(schedule.id, {
      agentTaskQueue,
      getNotificationConversationId: async () => conversation.id,
    });

    const run = await prisma.scheduledTaskRun.findFirstOrThrow({ where: { scheduledTaskId: schedule.id } });
    const task = await prisma.task.findUniqueOrThrow({ where: { id: run.taskId! } });
    expect(task.conversationId).toBe(conversation.id);
  });
});
