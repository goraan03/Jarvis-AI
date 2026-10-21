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
  await prisma.user.create({ data: { email, passwordHash, settings: { create: {} } } });

  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password });
  return agent;
}

describe("settings", () => {
  it("returns default settings and allows a partial update", async () => {
    const app = createApp();
    const agent = await loginNewUser(app);

    const getRes = await agent.get("/api/v1/settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.maxConcurrentTasks).toBe(2);

    const patchRes = await agent
      .patch("/api/v1/settings")
      .set("X-Jarvis-Client", "web")
      .send({ maxConcurrentTasks: 5 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.maxConcurrentTasks).toBe(5);
  });
});
