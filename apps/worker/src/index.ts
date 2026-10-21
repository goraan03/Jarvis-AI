import "dotenv/config";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@jarvis/shared";
import { createModelProvider, buildToolRegistry, createAgentTaskWorker } from "@jarvis/ai-engine";

const env = loadEnv();
const logger = pino({ transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined });

async function main() {
  // Liveness check — proves Redis is actually reachable before BullMQ
  // starts (BullMQ's own connection retries would otherwise mask a
  // misconfigured REDIS_URL as silence).
  const probe = new Redis(env.REDIS_URL, { connectTimeout: 2000, retryStrategy: () => null });
  await probe.ping();
  await probe.quit();

  // BullMQ manages its own retry/reconnect behavior and requires this.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const modelProvider = createModelProvider(env.AI_PROVIDER);
  const tools = buildToolRegistry({ braveSearchApiKey: env.BRAVE_SEARCH_API_KEY });

  const worker = createAgentTaskWorker(connection, { modelProvider, tools });

  worker.on("completed", (job) => {
    logger.info({ taskId: job.data.taskId }, "agent task finished");
  });
  worker.on("failed", (job, err) => {
    logger.error({ taskId: job?.data.taskId, err }, "agent task run threw");
  });

  logger.info(
    { tools: tools.map((t) => t.name), provider: env.AI_PROVIDER },
    "jarvis worker listening on agent-tasks",
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, "shutting down worker");
      await worker.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  logger.error({ err: error }, "worker failed to start");
  process.exitCode = 1;
});
