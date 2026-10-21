import "dotenv/config";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@jarvis/shared";

const env = loadEnv();
const logger = pino({ transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined });

/**
 * Placeholder worker process for Phase 1. Proves the process can connect
 * to Redis; BullMQ queue consumers (agent-tasks, scheduled-jobs, etc.)
 * are added starting Phase 3 per docs/implementation-roadmap.md.
 */
async function main() {
  const redis = new Redis(env.REDIS_URL, { connectTimeout: 2000, retryStrategy: () => null });
  await redis.ping();
  logger.info("jarvis worker connected to redis, idle (no queues registered yet)");
}

main().catch((error) => {
  logger.error({ err: error }, "worker failed to start");
  process.exitCode = 1;
});
