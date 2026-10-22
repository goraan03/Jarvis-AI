import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { SCHEDULED_TASK_QUEUE_NAME, type ScheduledJobData } from "./types.js";
import { runScheduledTaskJob, type SchedulerRunnerDeps } from "./runner.js";

export function createScheduledTaskQueue(connection: ConnectionOptions): Queue<ScheduledJobData> {
  return new Queue<ScheduledJobData>(SCHEDULED_TASK_QUEUE_NAME, { connection });
}

export function createScheduledTaskWorker(
  connection: ConnectionOptions,
  deps: SchedulerRunnerDeps,
  concurrency = 3,
): Worker<ScheduledJobData> {
  return new Worker<ScheduledJobData>(
    SCHEDULED_TASK_QUEUE_NAME,
    async (job: Job<ScheduledJobData>) => {
      await runScheduledTaskJob(job.data.scheduledTaskId, deps);
    },
    { connection, concurrency },
  );
}
