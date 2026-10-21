import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { runAgentTask, type RunAgentTaskDeps } from "./agent/engine.js";

export const AGENT_TASK_QUEUE_NAME = "agent-tasks";

export interface AgentTaskJobData {
  taskId: string;
}

export function createAgentTaskQueue(connection: ConnectionOptions): Queue<AgentTaskJobData> {
  return new Queue<AgentTaskJobData>(AGENT_TASK_QUEUE_NAME, { connection });
}

export async function enqueueAgentTask(queue: Queue<AgentTaskJobData>, taskId: string): Promise<void> {
  await queue.add("run", { taskId }, { jobId: taskId, removeOnComplete: true, removeOnFail: false });
}

/**
 * Starts the BullMQ consumer for agent-tasks. Each job just delegates to
 * runAgentTask, which does its own persistence — the worker process can
 * crash and restart without losing task state beyond "stuck RUNNING,"
 * which Phase 6's reconciliation work addresses for the scheduler; for
 * Phase 3 a stuck task is visible (status RUNNING, no further progress)
 * rather than silently lost.
 */
export function createAgentTaskWorker(connection: ConnectionOptions, deps: RunAgentTaskDeps, concurrency = 3): Worker<AgentTaskJobData> {
  return new Worker<AgentTaskJobData>(
    AGENT_TASK_QUEUE_NAME,
    async (job: Job<AgentTaskJobData>) => {
      await runAgentTask(job.data.taskId, deps);
    },
    { connection, concurrency },
  );
}
