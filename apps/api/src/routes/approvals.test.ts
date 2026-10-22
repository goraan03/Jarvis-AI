import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

async function makeApproval(userId: string) {
  const task = await prisma.task.create({ data: { userId, goal: "send an email", limits: {} } });
  return prisma.approvalRequest.create({
    data: {
      userId,
      taskId: task.id,
      toolName: "send_email",
      boundInput: { to: "a@example.com", body: "hi" },
      inputHash: "irrelevant-for-this-test",
      requestedVia: "WEB",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

describe("approvals", () => {
  it("lists only this user's pending approvals", async () => {
    const app = createApp({ taskQueue: { add: vi.fn(async () => ({})) } as any });
    const { agent, user } = await loginNewUser(app);
    await makeApproval(user.id);

    const { agent: otherAgent } = await loginNewUser(app);

    const mine = await agent.get("/api/v1/approvals?status=pending");
    expect(mine.body.data).toHaveLength(1);

    const theirs = await otherAgent.get("/api/v1/approvals?status=pending");
    expect(theirs.body.data).toHaveLength(0);
  });

  it("approves a pending request and re-enqueues the task", async () => {
    const queue = { add: vi.fn(async () => ({})) };
    const app = createApp({ taskQueue: queue as any });
    const { agent, user } = await loginNewUser(app);
    const approval = await makeApproval(user.id);

    const res = await agent.post(`/api/v1/approvals/${approval.id}/approve`).set("X-Jarvis-Client", "web");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(queue.add).toHaveBeenCalledTimes(1);

    const audit = await prisma.auditLog.findFirst({ where: { userId: user.id, action: "approval.approve" } });
    expect(audit?.entityId).toBe(approval.id);
    expect((audit?.metadata as { toolName?: string } | null)?.toolName).toBe("send_email");
  });

  it("rejects approving the same request twice", async () => {
    const app = createApp({ taskQueue: { add: vi.fn(async () => ({})) } as any });
    const { agent, user } = await loginNewUser(app);
    const approval = await makeApproval(user.id);

    await agent.post(`/api/v1/approvals/${approval.id}/approve`).set("X-Jarvis-Client", "web");
    const second = await agent.post(`/api/v1/approvals/${approval.id}/reject`).set("X-Jarvis-Client", "web");
    expect(second.status).toBe(400);
  });

  it("does not let one user decide another user's approval", async () => {
    const app = createApp({ taskQueue: { add: vi.fn(async () => ({})) } as any });
    const { user } = await loginNewUser(app);
    const approval = await makeApproval(user.id);
    const { agent: otherAgent } = await loginNewUser(app);

    const res = await otherAgent.post(`/api/v1/approvals/${approval.id}/approve`).set("X-Jarvis-Client", "web");
    expect(res.status).toBe(404);
  });

  it("404s for an unknown approval id", async () => {
    const app = createApp({ taskQueue: { add: vi.fn(async () => ({})) } as any });
    const { agent } = await loginNewUser(app);
    const res = await agent.get("/api/v1/approvals/does-not-exist");
    expect(res.status).toBe(404);
  });
});
