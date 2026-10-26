import "@jarvis/shared/src/loadRootEnv.js";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@jarvis/shared";
import {
  createModelProvider,
  buildToolRegistry,
  createAgentTaskWorker,
  createAgentTaskQueue,
  resolveMemoryTools,
  type ToolDefinition,
} from "@jarvis/ai-engine";
import {
  createTelegramClient,
  startTelegramPolling,
  notifyTaskResult,
  createGoogleToolsResolver,
  getTelegramConversationIdIfConnected,
} from "@jarvis/integrations";
import { createScheduledTaskQueue, createScheduledTaskWorker, reconcileScheduledTasks } from "@jarvis/scheduler";
import { createBrowserTaskQueue, createBrowserTaskQueueEvents, buildBrowserTools } from "@jarvis/browser-automation";

const env = loadEnv();
const logger = pino({ transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined });

// BullMQ already catches errors thrown inside job processors (see the
// worker.on("failed", ...) handlers below) without crashing the process —
// this is only for genuinely unanticipated errors outside that lifecycle.
// Fail loud and exit; a process manager is the actual uptime mechanism.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection — exiting");
  process.exit(1);
});

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
  const scheduledQueue = createScheduledTaskQueue(connection);

  // QueueEvents needs its own dedicated connection (BullMQ's
  // pub/sub-style consumption shouldn't share a connection used for
  // other blocking operations).
  let browserQueueEvents: ReturnType<typeof createBrowserTaskQueueEvents> | undefined;
  if (env.BROWSER_WORKER_ENABLED) {
    const browserQueue = createBrowserTaskQueue(connection);
    const browserEventsConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    browserQueueEvents = createBrowserTaskQueueEvents(browserEventsConnection);
    tools.push(...buildBrowserTools({ queue: browserQueue, queueEvents: browserQueueEvents }));
    logger.info("browser tools enabled — apps/browser-worker must be running separately");
  } else {
    logger.info("BROWSER_WORKER_ENABLED not set — browser tools disabled");
  }

  const googleConfigured = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI && env.ENCRYPTION_MASTER_KEY;
  const resolveGoogleTools = googleConfigured
    ? createGoogleToolsResolver({
        oauth: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, redirectUri: env.GOOGLE_REDIRECT_URI! },
        encryptionMasterKey: env.ENCRYPTION_MASTER_KEY!,
      })
    : async () => [] as ToolDefinition<any, any>[];
  logger.info({ googleConfigured: !!googleConfigured }, googleConfigured ? "Gmail/Calendar/Drive tools available per-user" : "Google not configured — Gmail/Calendar/Drive tools disabled");

  async function resolveDynamicTools(userId: string): Promise<ToolDefinition<any, any>[]> {
    const [googleTools, memoryTools] = await Promise.all([resolveGoogleTools(userId), resolveMemoryTools(userId)]);
    return [...googleTools, ...memoryTools];
  }

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

  const scheduledWorker = createScheduledTaskWorker(connection, {
    agentTaskQueue: taskQueue,
    getNotificationConversationId: telegramClient ? getTelegramConversationIdIfConnected : undefined,
  });
  scheduledWorker.on("failed", (job, err) => {
    logger.error({ scheduledTaskId: job?.data.scheduledTaskId, err }, "scheduled job run threw");
  });

  const reconciledCount = await reconcileScheduledTasks(scheduledQueue);
  logger.info({ reconciledCount }, "reconciled active scheduled tasks with BullMQ");

  logger.info(
    { tools: tools.map((t) => t.name), provider: env.AI_PROVIDER },
    "jarvis worker listening on agent-tasks and scheduled-jobs",
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, "shutting down worker");
      await Promise.all([worker.close(), scheduledWorker.close(), browserQueueEvents?.close()]);
      process.exit(0);
    });
  }
}

main().catch((error) => {
  logger.error({ err: error }, "worker failed to start");
  process.exitCode = 1;
});
