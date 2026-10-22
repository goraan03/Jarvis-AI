import { z } from "zod";
import { prisma, Prisma } from "@jarvis/database";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(20).optional().default(5),
});
const outputSchema = z.object({
  memories: z.array(z.object({ id: z.string(), category: z.string(), content: z.string(), confidence: z.number() })),
});

interface MemoryRow {
  id: string;
  category: string;
  content: string;
  confidence: number;
}

/**
 * Postgres full-text search over the owner's approved memories only —
 * proposed/rejected/archived entries never leak into what the model can
 * recall. Uses plainto_tsquery so arbitrary free-text input can't break
 * tsquery syntax — docs/database-design.md "Memory".
 */
export const searchMemoryTool: ToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: "search_memory",
  description: "Searches the owner's approved long-term memories for relevant facts/preferences.",
  inputSchema,
  outputSchema,
  inputJsonSchema: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "integer" } },
    required: ["query"],
  },
  riskLevel: "low",
  requiresApproval: false,
  timeoutMs: 5000,
  async handler(input, ctx) {
    const rows = await prisma.$queryRaw<MemoryRow[]>(
      Prisma.sql`
        SELECT id, category, content, confidence
        FROM "Memory"
        WHERE "userId" = ${ctx.userId}
          AND status = 'APPROVED'
          AND "searchVector" @@ plainto_tsquery('english', ${input.query})
        ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${input.query})) DESC
        LIMIT ${input.limit}
      `,
    );
    return { memories: rows };
  },
};
