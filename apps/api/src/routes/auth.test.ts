import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { createApp } from "../app.js";

async function makeUser(password = "correct-horse-battery") {
  const email = `${randomUUID()}@example.com`;
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, settings: { create: {} } },
  });
  return { user, email, password };
}

describe("auth", () => {
  it("rejects login with the wrong password", async () => {
    const app = createApp();
    const { email } = await makeUser();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Jarvis-Client", "web")
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects a mutating request without the CSRF header", async () => {
    const app = createApp();
    const { email, password } = await makeUser();
    const res = await request(app).post("/api/v1/auth/login").send({ email, password });
    expect(res.status).toBe(403);
  });

  it("logs in, resolves /auth/me via the session cookie, then logs out", async () => {
    const app = createApp();
    const { email, password, user } = await makeUser();
    const agent = request.agent(app);

    const loginRes = await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.id).toBe(user.id);

    const meRes = await agent.get("/api/v1/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(email);

    const logoutRes = await agent.post("/api/v1/auth/logout").set("X-Jarvis-Client", "web");
    expect(logoutRes.status).toBe(204);

    const meAfterLogoutRes = await agent.get("/api/v1/auth/me");
    expect(meAfterLogoutRes.status).toBe(401);

    const auditActions = (await prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })).map(
      (a) => a.action,
    );
    expect(auditActions).toEqual(["auth.login", "auth.logout"]);
  });

  it("rejects an unauthenticated request to a protected route", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/conversations");
    expect(res.status).toBe(401);
  });
});
