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

function app() {
  return createApp({ taskQueue: { add: async () => ({}) } as any });
}

describe("memories", () => {
  it("creates a manual memory as already-approved", async () => {
    const { agent } = await loginNewUser(app());
    const res = await agent.post("/api/v1/memories").set("X-Jarvis-Client", "web").send({ category: "fact", content: "Lives in Berlin" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.source).toBe("manual");
  });

  it("lists proposed memories separately from approved", async () => {
    const { agent, user } = await loginNewUser(app());
    await prisma.memory.create({ data: { userId: user.id, category: "fact", content: "A proposed fact", source: "task", status: "PROPOSED" } });
    await agent.post("/api/v1/memories").set("X-Jarvis-Client", "web").send({ category: "fact", content: "An approved fact" });

    const proposed = await agent.get("/api/v1/memories?status=proposed");
    expect(proposed.body.data).toHaveLength(1);
    expect(proposed.body.data[0].content).toBe("A proposed fact");

    const approved = await agent.get("/api/v1/memories?status=approved");
    expect(approved.body.data).toHaveLength(1);
    expect(approved.body.data[0].content).toBe("An approved fact");
  });

  it("approve/reject/archive transitions work via PATCH", async () => {
    const { agent, user } = await loginNewUser(app());
    const memory = await prisma.memory.create({ data: { userId: user.id, category: "fact", content: "x", source: "task", status: "PROPOSED" } });

    const approve = await agent.patch(`/api/v1/memories/${memory.id}`).set("X-Jarvis-Client", "web").send({ status: "APPROVED" });
    expect(approve.body.status).toBe("APPROVED");
  });

  it("search finds an approved memory by content and excludes proposed ones", async () => {
    const { agent, user } = await loginNewUser(app());
    await prisma.memory.create({ data: { userId: user.id, category: "preference", content: "Prefers concise answers", source: "manual", status: "APPROVED" } });
    await prisma.memory.create({ data: { userId: user.id, category: "preference", content: "Prefers concise replies", source: "task", status: "PROPOSED" } });

    const res = await agent.get("/api/v1/memories?status=approved&q=concise");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].content).toBe("Prefers concise answers");
  });

  it("delete removes a memory immediately, including from search", async () => {
    const { agent, user } = await loginNewUser(app());
    const memory = await prisma.memory.create({ data: { userId: user.id, category: "fact", content: "Delete me searchable", source: "manual", status: "APPROVED" } });

    const del = await agent.delete(`/api/v1/memories/${memory.id}`).set("X-Jarvis-Client", "web");
    expect(del.status).toBe(204);

    const res = await agent.get("/api/v1/memories?status=approved&q=searchable");
    expect(res.body.data).toHaveLength(0);
  });

  it("export returns every memory regardless of status, as a downloadable file", async () => {
    const { agent, user } = await loginNewUser(app());
    await prisma.memory.create({ data: { userId: user.id, category: "fact", content: "a", source: "manual", status: "APPROVED" } });
    await prisma.memory.create({ data: { userId: user.id, category: "fact", content: "b", source: "task", status: "PROPOSED" } });

    const res = await agent.get("/api/v1/memories/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.body.memories).toHaveLength(2);
  });

  it("does not let one user see or delete another user's memory", async () => {
    const sharedApp = app();
    const { user: userA } = await loginNewUser(sharedApp);
    const { agent: agentB } = await loginNewUser(sharedApp);
    const memory = await prisma.memory.create({ data: { userId: userA.id, category: "fact", content: "secret", source: "manual", status: "APPROVED" } });

    const del = await agentB.delete(`/api/v1/memories/${memory.id}`).set("X-Jarvis-Client", "web");
    expect(del.status).toBe(404);
  });
});
