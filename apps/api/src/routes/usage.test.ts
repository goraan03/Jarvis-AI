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

describe("usage route", () => {
  it("rolls up tokens and cost across this user's usage records", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent, user } = await loginNewUser(app);
    await prisma.usageRecord.createMany({
      data: [
        { userId: user.id, provider: "mock", model: "m", inputTokens: 10, outputTokens: 5, estimatedCostMicroUsd: 100 },
        { userId: user.id, provider: "mock", model: "m", inputTokens: 20, outputTokens: 15, estimatedCostMicroUsd: 200 },
      ],
    });

    const res = await agent.get("/api/v1/usage");
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ inputTokens: 30, outputTokens: 20, estimatedCostMicroUsd: 300, callCount: 2 });
    expect(res.body.byDay).toHaveLength(1);
    expect(res.body.byDay[0].callCount).toBe(2);
  });

  it("never rolls up another user's usage records", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { user: owner } = await loginNewUser(app);
    await prisma.usageRecord.create({
      data: { userId: owner.id, provider: "mock", model: "m", inputTokens: 999, outputTokens: 999, estimatedCostMicroUsd: 999 },
    });

    const { agent: otherAgent } = await loginNewUser(app);
    const res = await otherAgent.get("/api/v1/usage");
    expect(res.body.totals).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCostMicroUsd: 0, callCount: 0 });
  });

  it("rejects an invalid date filter", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent } = await loginNewUser(app);
    const res = await agent.get("/api/v1/usage?to=garbage");
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const res = await request(app).get("/api/v1/usage").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(401);
  });
});
