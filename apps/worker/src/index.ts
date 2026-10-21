import "dotenv/config";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@jarvis/shared";
import { createModelProvider, buildToolRegistry, createAgentTaskWorker, createAgentTaskQueue } from "@jarvis/ai-engine";
import { createTelegramClient, startTelegramPolling, notifyTaskResult, createGoogleToolsResolver } from "@jarvis/integrations";

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
  const taskQueue = createAgentTaskQueue(connection);

  const googleConfigured = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI && env.ENCRYPTION_MASTER_KEY;
  const resolveDynamicTools = googleConfigured
    ? createGoogleToolsResolver({
        oauth: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, redirectUri: env.GOOGLE_REDIRECT_URI! },
        encryptionMasterKey: env.ENCRYPTION_MASTER_KEY!,
      })
    : undefined;
  logger.info({ googleConfigured: !!googleConfigured }, googleConfigured ? "Gmail/Calendar tools available per-user" : "Google not configured — Gmail/Calendar tools disabled");

  const telegramClient = env.TELEGRAM_BOT_TOKEN ? createTelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined;
  if (telegramClient) {
    try {
      const me = await telegramClient.getMe();
      logger.info({ username: me.username }, "telegram bot token verified");
      startTelegramPolling(telegramClient, { client: telegramClient, taskQueue }, (error) => {
        logger.error({ err: error }, "telegram polling error");
      });
    } catch (error) {
      logger.error({ err: error }, "TELEGRAM_BOT_TOKEN is set but invalid — Telegram is disabled this run");
    }
  } else {
    logger.info("TELEGRAM_BOT_TOKEN not set — Telegram integration disabled");
  }

  const worker = createAgentTaskWorker(connection, { modelProvider, tools, resolveDynamicTools });

  worker.on("completed", async (job) => {
    logger.info({ taskId: job.data.taskId }, "agent task finished");
    if (telegramClient) {
      await notifyTaskResult(job.data.taskId, telegramClient).catch((error) =>
        logger.error({ err: error, taskId: job.data.taskId }, "failed to send telegram notification"),
      );
    }
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
