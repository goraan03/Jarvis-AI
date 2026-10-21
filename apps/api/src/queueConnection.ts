import { Redis } from "ioredis";
import { env } from "./env.js";

// BullMQ requires its own connection with maxRetriesPerRequest: null (it
// manages retries itself) — kept separate from redis.ts, which is tuned
// to fail fast for health checks instead.
export const bullRedisConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
