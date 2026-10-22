import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@jarvis/database";
import { generateResearchReportTool } from "./generateResearchReport.js";

async function makeTask() {
  const email = `${randomUUID()}@example.com`;
  const user = await prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
  const task = await prisma.task.create({ data: { userId: user.id, goal: "research something", limits: {} } });
  return { user, task };
}

async function makeToolExecution(taskId: string, status: "SUCCEEDED" | "FAILED" = "SUCCEEDED") {
  return prisma.toolExecution.create({
    data: { taskId, toolName: "search_web", input: {}, output: status === "SUCCEEDED" ? {} : undefined, status, riskLevel: "low" },
  });
}

describe("generateResearchReportTool", () => {
  it("creates a report when every cited source is a real, successful execution belonging to this task", async () => {
    const { user, task } = await makeTask();
    const execution = await makeToolExecution(task.id);

    const result = await generateResearchReportTool.handler(
      { title: "Report", summary: "Summary text", sources: [{ toolExecutionId: execution.id, note: "found this" }] },
      { userId: user.id, taskId: task.id },
    );

    expect(result.sourceCount).toBe(1);
    const stored = await prisma.researchReport.findUniqueOrThrow({ where: { id: result.reportId } });
    expect(stored.userId).toBe(user.id);
    expect(stored.taskId).toBe(task.id);
    expect(stored.sources).toEqual([{ toolExecutionId: execution.id, note: "found this" }]);
  });

  it("rejects a citation for a toolExecutionId that doesn't exist", async () => {
    const { user, task } = await makeTask();

    await expect(
      generateResearchReportTool.handler(
        { title: "Report", summary: "Summary text", sources: [{ toolExecutionId: "nonexistent-id", note: "x" }] },
        { userId: user.id, taskId: task.id },
      ),
    ).rejects.toThrow(/no such tool execution/);
  });

  it("rejects a citation for a toolExecutionId that belongs to a different task", async () => {
    const { user, task } = await makeTask();
    const { task: otherTask } = await makeTask();
    const foreignExecution = await makeToolExecution(otherTask.id);

    await expect(
      generateResearchReportTool.handler(
        { title: "Report", summary: "Summary text", sources: [{ toolExecutionId: foreignExecution.id, note: "x" }] },
        { userId: user.id, taskId: task.id },
      ),
    ).rejects.toThrow(/does not belong to this task/);
  });

  it("rejects a citation for a toolExecutionId whose call did not succeed", async () => {
    const { user, task } = await makeTask();
    const failedExecution = await makeToolExecution(task.id, "FAILED");

    await expect(
      generateResearchReportTool.handler(
        { title: "Report", summary: "Summary text", sources: [{ toolExecutionId: failedExecution.id, note: "x" }] },
        { userId: user.id, taskId: task.id },
      ),
    ).rejects.toThrow(/did not succeed/);
  });

  it("does not create a report at all when one of several citations fails verification", async () => {
    const { user, task } = await makeTask();
    const goodExecution = await makeToolExecution(task.id);

    await expect(
      generateResearchReportTool.handler(
        {
          title: "Report",
          summary: "Summary text",
          sources: [
            { toolExecutionId: goodExecution.id, note: "good" },
            { toolExecutionId: "fake-id", note: "bad" },
          ],
        },
        { userId: user.id, taskId: task.id },
      ),
    ).rejects.toThrow();

    const reports = await prisma.researchReport.findMany({ where: { taskId: task.id } });
    expect(reports).toHaveLength(0);
  });
});
