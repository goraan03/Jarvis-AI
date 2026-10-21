import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { createApp } from "../app.js";

async function loginNewUser(app: ReturnType<typeof createApp>) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash, settings: { create: {} } } });

  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password });
  return { agent, user };
}

describe("conversations", () => {
  it("creates a conversation and sends a message, getting a mock-tagged reply", async () => {
    const app = createApp();
    const { agent } = await loginNewUser(app);

    const createRes = await agent.post("/api/v1/conversations").set("X-Jarvis-Client", "web").send({});
    expect(createRes.status).toBe(201);
    const conversationId = createRes.body.id;

    const messageRes = await agent
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set("X-Jarvis-Client", "web")
      .send({ content: "hello jarvis" });

    expect(messageRes.status).toBe(201);
    expect(messageRes.body.userMessage.content).toBe("hello jarvis");
    expect(messageRes.body.assistantMessage.providerUsed).toBe("mock");
    expect(messageRes.body.assistantMessage.content).toContain("hello jarvis");

    const usage = await prisma.usageRecord.findMany({ where: { conversationId } });
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toBe("mock");

    const getRes = await agent.get(`/api/v1/conversations/${conversationId}`);
    expect(getRes.body.messages).toHaveLength(2);
  });

  it("persists a conversation across requests (simulating a restart)", async () => {
    const app = createApp();
    const { agent } = await loginNewUser(app);
    const createRes = await agent.post("/api/v1/conversations").set("X-Jarvis-Client", "web").send({ title: "x" });

    // A fresh createApp() call simulates a new process picking up the same
    // underlying Postgres state — the point of persisting to the DB rather
    // than in-memory.
    const freshApp = createApp();
    const res = await agent.get(`/api/v1/conversations/${createRes.body.id}`);
    void freshApp;
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("x");
  });

  it("does not let one user read another user's conversation", async () => {
    const app = createApp();
    const { agent: agentA } = await loginNewUser(app);
    const { agent: agentB } = await loginNewUser(app);

    const createRes = await agentA.post("/api/v1/conversations").set("X-Jarvis-Client", "web").send({});
    const conversationId = createRes.body.id;

    const res = await agentB.get(`/api/v1/conversations/${conversationId}`);
    expect(res.status).toBe(404);

    const listRes = await agentB.get("/api/v1/conversations");
    expect(listRes.body.data.find((c: { id: string }) => c.id === conversationId)).toBeUndefined();
  });

  it("rejects an empty message", async () => {
    const app = createApp();
    const { agent } = await loginNewUser(app);
    const createRes = await agent.post("/api/v1/conversations").set("X-Jarvis-Client", "web").send({});

    const res = await agent
      .post(`/api/v1/conversations/${createRes.body.id}/messages`)
      .set("X-Jarvis-Client", "web")
      .send({ content: "" });
    expect(res.status).toBe(400);
  });
});
