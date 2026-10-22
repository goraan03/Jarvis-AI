import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { createApp } from "./app.js";

describe("GET /api/v1/health", () => {
  it("returns ok without requiring auth or DB/Redis", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/v1/health/ready", () => {
  it("reports per-dependency status", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/health/ready");
    expect(res.body.checks).toHaveProperty("database");
    expect(res.body.checks).toHaveProperty("redis");
    expect([200, 503]).toContain(res.status);
  });
});

describe("unhandled route errors", () => {
  it("returns a generic JSON 500 instead of Express's default HTML error page", async () => {
    const app = createApp({
      taskQueue: {
        add: async () => {
          throw new Error("queue is on fire — internal detail that must not reach the client");
        },
      } as any,
    });

    const email = `${randomUUID()}@example.com`;
    const passwordHash = await hashPassword("correct-horse-battery");
    await prisma.user.create({ data: { email, passwordHash, settings: { create: {} } } });
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password: "correct-horse-battery" });

    const res = await agent.post("/api/v1/tasks").set("X-Jarvis-Client", "web").send({ goal: "do something" });

    expect(res.status).toBe(500);
    expect(res.type).toBe("application/json");
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("queue is on fire");
  });
});
