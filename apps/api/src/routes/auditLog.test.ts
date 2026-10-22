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

describe("audit log route", () => {
  it("includes the login that just happened", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent, user } = await loginNewUser(app);

    const res = await agent.get("/api/v1/audit-log");
    expect(res.status).toBe(200);
    expect(res.body.data.some((e: { action: string; userId: string }) => e.action === "auth.login" && e.userId === user.id)).toBe(
      true,
    );
  });

  it("filters by action", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent, user } = await loginNewUser(app);
    await prisma.auditLog.create({ data: { userId: user.id, action: "integration.connect" } });

    const res = await agent.get("/api/v1/audit-log?action=integration.connect");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toBe("integration.connect");
  });

  it("rejects an invalid from date", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent } = await loginNewUser(app);

    const res = await agent.get("/api/v1/audit-log?from=not-a-date");
    expect(res.status).toBe(400);
  });

  it("never returns another user's audit entries", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { user: owner } = await loginNewUser(app);
    await prisma.auditLog.create({ data: { userId: owner.id, action: "tool.execute" } });

    const { agent: otherAgent } = await loginNewUser(app);
    const res = await otherAgent.get("/api/v1/audit-log");
    expect(res.body.data.every((e: { userId: string }) => e.userId !== owner.id)).toBe(true);
  });

  it("requires auth", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const res = await request(app).get("/api/v1/audit-log").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(401);
  });
});
