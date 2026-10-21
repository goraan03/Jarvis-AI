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

const oauthConfig = { clientId: "test-client", clientSecret: "test-secret", redirectUri: "http://localhost:4100/api/v1/integrations/google/callback" };

describe("GET /api/v1/integrations/google/connect", () => {
  it("returns 501 when Google isn't configured", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent } = await loginNewUser(app);
    const res = await agent.get("/api/v1/integrations/google/connect");
    expect(res.status).toBe(501);
  });

  it("redirects to Google's consent screen when configured", async () => {
    const app = createApp({
      taskQueue: { add: async () => ({}) } as any,
      googleOAuth: oauthConfig,
      encryptionMasterKey: Buffer.alloc(32, 1).toString("base64"),
    });
    const { agent } = await loginNewUser(app);
    const res = await agent.get("/api/v1/integrations/google/connect");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("requires authentication", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any, googleOAuth: oauthConfig, encryptionMasterKey: "x" });
    const res = await request(app).get("/api/v1/integrations/google/connect");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/integrations/google/callback", () => {
  it("rejects a callback with an invalid or missing state", async () => {
    const app = createApp({
      taskQueue: { add: async () => ({}) } as any,
      googleOAuth: oauthConfig,
      encryptionMasterKey: Buffer.alloc(32, 1).toString("base64"),
    });
    const res = await request(app).get("/api/v1/integrations/google/callback?code=abc&state=not-a-real-state");
    expect(res.status).toBe(400);
  });

  it("surfaces a Google-reported error without crashing", async () => {
    const app = createApp({
      taskQueue: { add: async () => ({}) } as any,
      googleOAuth: oauthConfig,
      encryptionMasterKey: Buffer.alloc(32, 1).toString("base64"),
    });
    const res = await request(app).get("/api/v1/integrations/google/callback?error=access_denied");
    expect(res.status).toBe(400);
  });
});
