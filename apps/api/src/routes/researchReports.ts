import { Router } from "express";
import { prisma } from "@jarvis/database";

interface ReportSource {
  toolExecutionId: string;
  note: string;
}

export const researchReportsRouter = Router();

researchReportsRouter.get("/", async (req, res) => {
  const reports = await prisma.researchReport.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, title: true, summary: true, taskId: true, sources: true, createdAt: true },
  });
  res.json({
    data: reports.map((report) => ({
      id: report.id,
      title: report.title,
      summary: report.summary,
      taskId: report.taskId,
      sourceCount: Array.isArray(report.sources) ? report.sources.length : 0,
      createdAt: report.createdAt,
    })),
  });
});

researchReportsRouter.get("/:id", async (req, res) => {
  const report = await prisma.researchReport.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!report) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Research report not found." } });
    return;
  }

  // The report's own `sources` Json is model-authored and only as
  // trustworthy as the real rows it names (docs/security-model.md §6) —
  // re-resolve each citation against ToolExecution here rather than
  // trusting the stored note/shape, so the API response always reflects
  // what actually happened, not what was claimed at creation time.
  const sources = (report.sources as unknown as ReportSource[]) ?? [];
  const executions = await prisma.toolExecution.findMany({
    where: { id: { in: sources.map((s) => s.toolExecutionId) }, taskId: report.taskId },
    select: { id: true, toolName: true, input: true, output: true, status: true, durationMs: true, createdAt: true },
  });
  const executionsById = new Map(executions.map((e) => [e.id, e]));

  const resolvedSources = sources.map((source) => ({
    note: source.note,
    toolExecution: executionsById.get(source.toolExecutionId) ?? null,
  }));

  res.json({
    id: report.id,
    title: report.title,
    summary: report.summary,
    taskId: report.taskId,
    createdAt: report.createdAt,
    sources: resolvedSources,
  });
});
