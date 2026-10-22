import { z } from "zod";
import { prisma } from "@jarvis/database";
import type { ToolDefinition } from "./types.js";

const sourceInputSchema = z.object({
  toolExecutionId: z.string().min(1),
  note: z.string().min(1).max(1000),
});
const inputSchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(20_000),
  sources: z.array(sourceInputSchema).min(1).max(50),
});
const outputSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  sourceCount: z.number(),
});

/**
 * Every citation must point at a real ToolExecution row that (a) exists,
 * (b) belongs to this exact task, and (c) actually succeeded — never
 * trusted from model output alone (docs/security-model.md §6: tool output
 * is data, not an authority; applied here to citations). A model claiming
 * "source: abc123" that doesn't check out fails the whole call rather than
 * silently dropping the bad citation, so a persisted report can never
 * contain an unverifiable source.
 */
export const generateResearchReportTool: ToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: "generate_research_report",
  description:
    "Creates a persisted research report with a summary and a list of cited sources. Each source must reference the toolExecutionId of a real, successful tool call made earlier in this same task.",
  inputSchema,
  outputSchema,
  inputJsonSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: { toolExecutionId: { type: "string" }, note: { type: "string" } },
          required: ["toolExecutionId", "note"],
        },
      },
    },
    required: ["title", "summary", "sources"],
  },
  riskLevel: "low",
  requiresApproval: false,
  timeoutMs: 10_000,
  async handler(input, ctx) {
    const uniqueIds = [...new Set(input.sources.map((s) => s.toolExecutionId))];
    const executions = await prisma.toolExecution.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, taskId: true, status: true },
    });
    const byId = new Map(executions.map((e) => [e.id, e]));

    for (const source of input.sources) {
      const execution = byId.get(source.toolExecutionId);
      if (!execution) {
        throw new Error(`Cannot cite toolExecutionId "${source.toolExecutionId}": no such tool execution exists.`);
      }
      if (execution.taskId !== ctx.taskId) {
        throw new Error(`Cannot cite toolExecutionId "${source.toolExecutionId}": it does not belong to this task.`);
      }
      if (execution.status !== "SUCCEEDED") {
        throw new Error(`Cannot cite toolExecutionId "${source.toolExecutionId}": that tool call did not succeed.`);
      }
    }

    const report = await prisma.researchReport.create({
      data: {
        userId: ctx.userId,
        taskId: ctx.taskId,
        title: input.title,
        summary: input.summary,
        sources: input.sources,
      },
    });

    return { reportId: report.id, title: report.title, sourceCount: input.sources.length };
  },
};
