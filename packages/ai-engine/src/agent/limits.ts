import { z } from "zod";

export const taskLimitsSchema = z.object({
  maxToolCallsPerTask: z.number().int().positive(),
  maxModelCallsPerTask: z.number().int().positive(),
  maxTaskDurationMs: z.number().int().positive(),
  maxTokensPerTask: z.number().int().positive(),
  maxCostMicroUsdPerTask: z.number().int().positive(),
  maxRetriesPerToolCall: z.number().int().min(0),
  model: z.string().min(1),
});

export type TaskLimits = z.infer<typeof taskLimitsSchema>;

/**
 * Snapshots the owner's current AgentSettings into a fixed set of limits
 * at task-creation time, so a later settings change never retroactively
 * changes the budget of a task that's already running —
 * docs/database-design.md "Task" model notes.
 */
export function buildTaskLimits(settings: {
  maxToolCallsPerTask: number;
  maxModelCallsPerTask: number;
  maxTaskDurationMs: number;
  maxTokensPerTask: number;
  maxCostMicroUsdPerTask: number;
  maxRetriesPerToolCall: number;
  defaultModel: string;
}): TaskLimits {
  return {
    maxToolCallsPerTask: settings.maxToolCallsPerTask,
    maxModelCallsPerTask: settings.maxModelCallsPerTask,
    maxTaskDurationMs: settings.maxTaskDurationMs,
    maxTokensPerTask: settings.maxTokensPerTask,
    maxCostMicroUsdPerTask: settings.maxCostMicroUsdPerTask,
    maxRetriesPerToolCall: settings.maxRetriesPerToolCall,
    model: settings.defaultModel,
  };
}
