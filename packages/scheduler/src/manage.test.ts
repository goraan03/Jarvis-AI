import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@jarvis/database";
import {
  createScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  cancelScheduledTask,
  updateScheduledTask,
  triggerScheduledTaskNow,
  ScheduledTaskNotFoundError,
  InvalidScheduleError,
} from "./manage.js";
import { reconcileScheduledTasks } from "./reconcile.js";

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

function fakeQueue() {
  return {
    upsertJobScheduler: vi.fn(async (_id: string, _repeat: unknown, _template?: unknown) => ({}) as any),
    removeJobScheduler: vi.fn(async (_id: string) => true),
    getJob: vi.fn(async (_id: string) => undefined),
    add: vi.fn(async (_name: string, _data: unknown, _opts?: unknown) => ({}) as any),
    remove: vi.fn(async (_id: string) => 0),
  };
}

describe("createScheduledTask", () => {
  it("registers a recurring schedule with upsertJobScheduler using the task's own id", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "Morning briefing",
      timezone: "UTC",
      payload: { goal: "summarize my day" },
      cronExpression: "0 8 * * *",
    });

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler.mock.calls[0][0]).toBe(task.id);
    expect(queue.upsertJobScheduler.mock.calls[0][1]).toEqual({ pattern: "0 8 * * *", tz: "UTC" });
    expect(task.status).toBe("active");
  });

  it("registers a one-time schedule as a delayed job", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const runAt = new Date(Date.now() + 60_000);
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "One-off reminder",
      timezone: "UTC",
      payload: { goal: "remind me" },
      runAt,
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2]).toMatchObject({ jobId: task.id });
  });

  it("rejects a schedule with neither or both of cronExpression/runAt", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    await expect(
      createScheduledTask(queue, { userId: user.id, name: "x", timezone: "UTC", payload: { goal: "x" } }),
    ).rejects.toBeInstanceOf(InvalidScheduleError);
    await expect(
      createScheduledTask(queue, {
        userId: user.id,
        name: "x",
        timezone: "UTC",
        payload: { goal: "x" },
        cronExpression: "0 8 * * *",
        runAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(InvalidScheduleError);
  });
});

describe("pause / resume / cancel", () => {
  it("pausing removes the BullMQ scheduler and flips status, resuming re-adds it", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const paused = await pauseScheduledTask(queue, task.id, user.id);
    expect(paused.status).toBe("paused");
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(task.id);

    const resumed = await resumeScheduledTask(queue, task.id, user.id);
    expect(resumed.status).toBe("active");
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
  });

  it("cancel is terminal and removes the BullMQ registration", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const cancelled = await cancelScheduledTask(queue, task.id, user.id);
    expect(cancelled.status).toBe("cancelled");
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(task.id);
  });

  it("throws ScheduledTaskNotFoundError for someone else's schedule", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: userA.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    await expect(pauseScheduledTask(queue, task.id, userB.id)).rejects.toBeInstanceOf(ScheduledTaskNotFoundError);
  });
});

describe("updateScheduledTask", () => {
  it("re-registers with the new cron when editing an active schedule", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const updated = await updateScheduledTask(queue, task.id, user.id, { cronExpression: "0 9 * * *" });
    expect(updated.cronExpression).toBe("0 9 * * *");
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(task.id);
    expect(queue.upsertJobScheduler).toHaveBeenLastCalledWith(task.id, { pattern: "0 9 * * *", tz: "UTC" }, expect.anything());
  });
});

describe("triggerScheduledTaskNow", () => {
  it("adds an immediate job for an owned schedule", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });
    queue.add.mockClear();

    await triggerScheduledTaskNow(queue, task.id, user.id);
    expect(queue.add).toHaveBeenCalledWith("run", { scheduledTaskId: task.id });
  });

  it("throws ScheduledTaskNotFoundError for an unowned schedule", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: userA.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    await expect(triggerScheduledTaskNow(queue, task.id, userB.id)).rejects.toBeInstanceOf(ScheduledTaskNotFoundError);
  });
});

describe("reconcileScheduledTasks", () => {
  it("re-registers every active schedule, idempotently, across repeated calls (simulating repeated worker restarts)", async () => {
    const user = await makeUser();
    const queue = fakeQueue();
    const task = await createScheduledTask(queue, {
      userId: user.id,
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });
    await pauseScheduledTask(queue, task.id, user.id); // should NOT be reconciled

    const other = await createScheduledTask(queue, {
      userId: user.id,
      name: "y",
      timezone: "UTC",
      payload: { goal: "y" },
      cronExpression: "0 9 * * *",
    });

    // reconcileScheduledTasks operates over every active schedule in the
    // database (correct — it's a global worker-boot operation), so other
    // tests' fixtures may also be present; assert on this test's own
    // schedules rather than absolute totals.
    queue.upsertJobScheduler.mockClear();
    await reconcileScheduledTasks(queue);
    const idsAfterFirst = queue.upsertJobScheduler.mock.calls.map((call) => call[0]);
    expect(idsAfterFirst).toContain(other.id);
    expect(idsAfterFirst).not.toContain(task.id); // paused — must not be reconciled

    queue.upsertJobScheduler.mockClear();
    await reconcileScheduledTasks(queue); // simulates a second worker boot
    const idsAfterSecond = queue.upsertJobScheduler.mock.calls.map((call) => call[0]);
    expect(idsAfterSecond).toContain(other.id); // same id both times — idempotent by construction
  });
});
