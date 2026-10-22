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

describe("integrations", () => {
  it("starts with no integrations connected", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent } = await loginNewUser(app);
    const res = await agent.get("/api/v1/integrations");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("generates a telegram link code, including a deep link when a bot username is configured", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any, telegramBotUsername: "JarvisTestBot" });
    const { agent } = await loginNewUser(app);
    const res = await agent.post("/api/v1/integrations/telegram/link-code").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[0-9A-F]{6}$/);
    expect(res.body.deepLink).toBe(`https://t.me/JarvisTestBot?start=${res.body.code}`);
  });

  it("omits the deep link when no bot username is configured", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent } = await loginNewUser(app);
    const res = await agent.post("/api/v1/integrations/telegram/link-code").set("X-Jarvis-Client", "web");
    expect(res.body.deepLink).toBeNull();
  });

  it("returns 404 disconnecting telegram when it was never connected", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent } = await loginNewUser(app);
    const res = await agent.delete("/api/v1/integrations/telegram").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(404);
  });

  it("writes an audit log entry when an integration is disconnected", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent, user } = await loginNewUser(app);
    await prisma.integration.create({
      data: { userId: user.id, provider: "telegram", status: "connected", externalId: "12345" },
    });

    const res = await agent.delete("/api/v1/integrations/telegram").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { userId: user.id, action: "integration.disconnect" } });
    expect((audit?.metadata as { provider?: string } | null)?.provider).toBe("telegram");
  });

  it("does not let one user see another user's integration status", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent: agentA, user: userA } = await loginNewUser(app);
    const { agent: agentB } = await loginNewUser(app);

    await prisma.integration.create({
      data: { userId: userA.id, provider: "telegram", status: "connected", externalId: "12345" },
    });

    const resA = await agentA.get("/api/v1/integrations");
    expect(resA.body.data).toHaveLength(1);

    const resB = await agentB.get("/api/v1/integrations");
    expect(resB.body.data).toHaveLength(0);
  });
});
