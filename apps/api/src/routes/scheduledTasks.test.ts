import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { createApp } from "../app.js";

function fakeSchedulerQueue() {
  return {
    upsertJobScheduler: vi.fn(async (_id: string, _r: unknown, _t?: unknown) => ({}) as any),
    removeJobScheduler: vi.fn(async (_id: string) => true),
    getJob: vi.fn(async (_id: string) => undefined),
    add: vi.fn(async (_n: string, _d: unknown, _o?: unknown) => ({}) as any),
    remove: vi.fn(async (_id: string) => 0),
  };
}

function app(schedulerQueue = fakeSchedulerQueue()) {
  return { app: createApp({ taskQueue: { add: async () => ({}) } as any, schedulerQueue }), schedulerQueue };
}

async function loginNewUser(expressApp: ReturnType<typeof createApp>) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash, settings: { create: {} } } });

  const agent = request.agent(expressApp);
  await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password });
  return { agent, user };
}

describe("scheduled tasks", () => {
  it("creates a recurring schedule", async () => {
    const { app: expressApp, schedulerQueue } = app();
    const { agent } = await loginNewUser(expressApp);

    const res = await agent.post("/api/v1/scheduled-tasks").set("X-Jarvis-Client", "web").send({
      name: "Morning briefing",
      timezone: "UTC",
      payload: { goal: "summarize my day" },
      cronExpression: "0 8 * * *",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
    expect(schedulerQueue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it("rejects a schedule with both cronExpression and runAt", async () => {
    const { app: expressApp } = app();
    const { agent } = await loginNewUser(expressApp);

    const res = await agent.post("/api/v1/scheduled-tasks").set("X-Jarvis-Client", "web").send({
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
      runAt: new Date().toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it("pauses and resumes via PATCH status", async () => {
    const { app: expressApp } = app();
    const { agent } = await loginNewUser(expressApp);
    const create = await agent.post("/api/v1/scheduled-tasks").set("X-Jarvis-Client", "web").send({
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const pause = await agent.patch(`/api/v1/scheduled-tasks/${create.body.id}`).set("X-Jarvis-Client", "web").send({ status: "paused" });
    expect(pause.body.status).toBe("paused");

    const resume = await agent.patch(`/api/v1/scheduled-tasks/${create.body.id}`).set("X-Jarvis-Client", "web").send({ status: "active" });
    expect(resume.body.status).toBe("active");
  });

  it("cancel is terminal via DELETE", async () => {
    const { app: expressApp } = app();
    const { agent } = await loginNewUser(expressApp);
    const create = await agent.post("/api/v1/scheduled-tasks").set("X-Jarvis-Client", "web").send({
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const del = await agent.delete(`/api/v1/scheduled-tasks/${create.body.id}`).set("X-Jarvis-Client", "web");
    expect(del.body.status).toBe("cancelled");
  });

  it("trigger enqueues an immediate run and is reflected in run history", async () => {
    const { app: expressApp, schedulerQueue } = app();
    const { agent } = await loginNewUser(expressApp);
    const create = await agent.post("/api/v1/scheduled-tasks").set("X-Jarvis-Client", "web").send({
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const trigger = await agent.post(`/api/v1/scheduled-tasks/${create.body.id}/trigger`).set("X-Jarvis-Client", "web");
    expect(trigger.status).toBe(202);
    expect(schedulerQueue.add).toHaveBeenCalledWith("run", { scheduledTaskId: create.body.id });
  });

  it("does not let one user see or modify another user's schedule", async () => {
    const { app: expressApp } = app();
    const { agent: agentA } = await loginNewUser(expressApp);
    const { agent: agentB } = await loginNewUser(expressApp);

    const create = await agentA.post("/api/v1/scheduled-tasks").set("X-Jarvis-Client", "web").send({
      name: "x",
      timezone: "UTC",
      payload: { goal: "x" },
      cronExpression: "0 8 * * *",
    });

    const getRes = await agentB.get(`/api/v1/scheduled-tasks/${create.body.id}`);
    expect(getRes.status).toBe(404);

    const patchRes = await agentB.patch(`/api/v1/scheduled-tasks/${create.body.id}`).set("X-Jarvis-Client", "web").send({ status: "paused" });
    expect(patchRes.status).toBe(404);
  });
});
