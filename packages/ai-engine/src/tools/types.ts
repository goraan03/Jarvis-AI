import type { ZodType } from "zod";

export interface ToolContext {
  userId: string;
  taskId: string;
}

export type ToolRiskLevel = "low" | "medium" | "high";

/**
 * Every tool the agent can call. Only tools returned by buildToolRegistry
 * (i.e. actually implemented and, if they need one, actually configured)
 * are ever presented to the model — docs/architecture.md §5.
 */
export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<Input>;
  outputSchema: ZodType<Output>;
  inputJsonSchema: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  timeoutMs: number;
  handler: (input: Input, ctx: ToolContext) => Promise<Output>;
}
