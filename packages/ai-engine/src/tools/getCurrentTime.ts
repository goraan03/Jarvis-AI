import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({});
const outputSchema = z.object({
  iso: z.string(),
  unixMs: z.number(),
});

/** Harmless, always-available local tool — no network, no secrets, no risk. */
export const getCurrentTimeTool: ToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: "get_current_time",
  description: "Returns the current date and time (UTC).",
  inputSchema,
  outputSchema,
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  riskLevel: "low",
  requiresApproval: false,
  timeoutMs: 1000,
  async handler() {
    const now = new Date();
    return { iso: now.toISOString(), unixMs: now.getTime() };
  },
};
