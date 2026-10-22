import { z } from "zod";
import { prisma } from "@jarvis/database";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  category: z.string().min(1).max(100),
  content: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).optional().default(1),
});
const outputSchema = z.object({ memoryId: z.string(), status: z.literal("proposed") });

/**
 * Only ever creates a PROPOSED row — never auto-approved. The owner
 * reviews/approves/edits/rejects on the Memory page; this tool cannot
 * bypass that (master spec §9). Only offered to a task at all when the
 * owner's AgentSettings.autoMemoryEnabled is true — see
 * resolveMemoryTools below.
 */
export const proposeMemoryTool: ToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: "propose_memory",
  description: "Proposes a fact or preference worth remembering long-term. Requires the owner's later approval.",
  inputSchema,
  outputSchema,
  inputJsonSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      content: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["category", "content"],
  },
  riskLevel: "low",
  requiresApproval: false,
  timeoutMs: 5000,
  async handler(input, ctx) {
    const memory = await prisma.memory.create({
      data: {
        userId: ctx.userId,
        category: input.category,
        content: input.content,
        confidence: input.confidence,
        source: "task",
        status: "PROPOSED",
      },
    });
    return { memoryId: memory.id, status: "proposed" };
  },
};

/** Per-task dynamic resolver: propose_memory is only offered when the
 * owner hasn't disabled automatic memory creation. */
export async function resolveMemoryTools(userId: string): Promise<ToolDefinition<any, any>[]> {
  const settings = await prisma.agentSettings.findUnique({ where: { userId } });
  return settings?.autoMemoryEnabled ? [proposeMemoryTool] : [];
}
