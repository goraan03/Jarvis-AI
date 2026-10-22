import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@jarvis/database";
import { hashPassword } from "@jarvis/security";
import { createApp } from "../app.js";

async function loginNewUser(expressApp: ReturnType<typeof createApp>) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash, settings: { create: {} } } });

  const agent = request.agent(expressApp);
  await agent.post("/api/v1/auth/login").set("X-Jarvis-Client", "web").send({ email, password });
  return { agent, user };
}

async function makeReportWithSource(userId: string) {
  const task = await prisma.task.create({ data: { userId, goal: "research something", limits: {} } });
  const execution = await prisma.toolExecution.create({
    data: { taskId: task.id, toolName: "search_web", input: {}, output: { results: [] }, status: "SUCCEEDED", riskLevel: "low" },
  });
  const report = await prisma.researchReport.create({
    data: {
      userId,
      taskId: task.id,
      title: "My report",
      summary: "The summary",
      sources: [{ toolExecutionId: execution.id, note: "from search_web" }],
    },
  });
  return { task, execution, report };
}

describe("research reports routes", () => {
  it("lists the logged-in user's reports with a source count", async () => {
    const expressApp = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent, user } = await loginNewUser(expressApp);
    await makeReportWithSource(user.id);

    const res = await agent.get("/api/v1/research-reports").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].sourceCount).toBe(1);
  });

  it("resolves a report's sources to the real ToolExecution rows that back them", async () => {
    const expressApp = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { agent, user } = await loginNewUser(expressApp);
    const { report, execution } = await makeReportWithSource(user.id);

    const res = await agent.get(`/api/v1/research-reports/${report.id}`).set("X-Jarvis-Client", "web");
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].toolExecution.id).toBe(execution.id);
    expect(res.body.sources[0].toolExecution.toolName).toBe("search_web");
    expect(res.body.sources[0].note).toBe("from search_web");
  });

  it("never returns another user's report, even by guessing its id", async () => {
    const expressApp = createApp({ taskQueue: { add: async () => ({}) } as any });
    const { user: owner } = await loginNewUser(expressApp);
    const { report } = await makeReportWithSource(owner.id);

    const { agent: otherAgent } = await loginNewUser(expressApp);
    const res = await otherAgent.get(`/api/v1/research-reports/${report.id}`).set("X-Jarvis-Client", "web");
    expect(res.status).toBe(404);
  });

  it("requires auth", async () => {
    const expressApp = createApp({ taskQueue: { add: async () => ({}) } as any });
    const res = await request(expressApp).get("/api/v1/research-reports").set("X-Jarvis-Client", "web");
    expect(res.status).toBe(401);
  });
});
