import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { createApp } from "../app.js";

function fakeQueue() {
  const add = vi.fn(async (_name: string, _data: { taskId: string }, _opts?: unknown) => ({ id: "fake-job" }));
  return { add } as any;
}

async function loginNewUser(app: ReturnType<typeof createApp>) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash, settings: { create: {} } } });

  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password });
  return { agent, user };
}

describe("tasks", () => {
  it("creates a task, enqueues it, and returns it pending", async () => {
    const queue = fakeQueue();
    const app = createApp({ taskQueue: queue });
    const { agent } = await loginNewUser(app);

    const res = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "do something useful" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.goal).toBe("do something useful");
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ taskId: res.body.id });
  });

  it("rejects an empty goal", async () => {
    const app = createApp({ taskQueue: fakeQueue() });
    const { agent } = await loginNewUser(app);
    const res = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "" });
    expect(res.status).toBe(400);
  });

  it("enforces the per-user concurrent task limit at creation time", async () => {
    const queue = fakeQueue();
    const app = createApp({ taskQueue: queue });
    const { agent, user } = await loginNewUser(app);
    await prisma.agentSettings.update({ where: { userId: user.id }, data: { maxConcurrentTasks: 1 } });

    const first = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "first" });
    expect(first.status).toBe(201);

    const second = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "second" });
    expect(second.status).toBe(429);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("does not let one user see or cancel another user's task", async () => {
    const app = createApp({ taskQueue: fakeQueue() });
    const { agent: agentA } = await loginNewUser(app);
    const { agent: agentB } = await loginNewUser(app);

    const createRes = await agentA.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "private" });

    const getRes = await agentB.get(`/api/v1/tasks/${createRes.body.id}`);
    expect(getRes.status).toBe(404);

    const cancelRes = await agentB.post(`/api/v1/tasks/${createRes.body.id}/cancel`).set("X-Jarvis-Client", "web");
    expect(cancelRes.status).toBe(404);
  });

  it("cancels a pending task and rejects cancelling it twice", async () => {
    const app = createApp({ taskQueue: fakeQueue() });
    const { agent } = await loginNewUser(app);
    const createRes = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "cancel me" });

    const cancelRes = await agent.post(`/api/v1/tasks/${createRes.body.id}/cancel`).set("X-Jarvis-Client", "web");
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("CANCELLED");

    const secondCancel = await agent.post(`/api/v1/tasks/${createRes.body.id}/cancel`).set("X-Jarvis-Client", "web");
    expect(secondCancel.status).toBe(400);
  });

  it("returns task detail including steps and tool executions", async () => {
    const app = createApp({ taskQueue: fakeQueue() });
    const { agent } = await loginNewUser(app);
    const createRes = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "detail check" });

    const detailRes = await agent.get(`/api/v1/tasks/${createRes.body.id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.steps).toEqual([]);
    expect(detailRes.body.toolExecutions).toEqual([]);
  });
});
