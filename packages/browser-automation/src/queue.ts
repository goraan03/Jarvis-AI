import { Queue, QueueEvents, Worker, type ConnectionOptions, type Job, type Processor } from "bullmq";
import { BROWSER_TASK_QUEUE_NAME, type BrowserJobData, type BrowserJobName } from "./types.js";

export function createBrowserTaskQueue(connection: ConnectionOptions): Queue<BrowserJobData> {
  return new Queue<BrowserJobData>(BROWSER_TASK_QUEUE_NAME, { connection });
}

/** BullMQ's request/response pattern requires a QueueEvents subscriber
 * (its own Redis connection) to observe job completion from outside the
 * worker process — this is how apps/worker calls into the fully
 * separate apps/browser-worker process and awaits a real result rather
 * than firing-and-forgetting. */
export function createBrowserTaskQueueEvents(connection: ConnectionOptions): QueueEvents {
  return new QueueEvents(BROWSER_TASK_QUEUE_NAME, { connection });
}

const RESULT_WAIT_TIMEOUT_MS = 35_000;

export async function enqueueBrowserJob<T>(
  queue: Pick<Queue<BrowserJobData>, "add">,
  queueEvents: QueueEvents,
  name: BrowserJobName,
  data: BrowserJobData,
  timeoutMs = RESULT_WAIT_TIMEOUT_MS,
): Promise<T> {
  const job = await queue.add(name, data, { removeOnComplete: true, removeOnFail: true });
  const result = await job.waitUntilFinished(queueEvents, timeoutMs);
  return result as T;
}

export function createBrowserTaskWorker(
  connection: ConnectionOptions,
  processor: Processor<BrowserJobData>,
  concurrency = 2,
): Worker<BrowserJobData> {
  return new Worker<BrowserJobData>(BROWSER_TASK_QUEUE_NAME, processor, { connection, concurrency });
}

export type { Job };
