import express, { type Express } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import { createModelProvider, createAgentTaskQueue, type ModelProvider, type AgentTaskJobData } from "@jarvis/ai-engine";
import { createTelegramClient, type TelegramClient, type GoogleOAuthConfig } from "@jarvis/integrations";
import { createScheduledTaskQueue, type ScheduledJobData } from "@jarvis/scheduler";
import { redis } from "./redis.js";
import { bullRedisConnection } from "./queueConnection.js";
import { logger } from "./logger.js";
import { env } from "./env.js";
import { sessionMiddleware, requireAuth } from "./auth/session.js";
import { csrfHeaderCheck } from "./auth/csrf.js";
import { authRouter } from "./routes/auth.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { settingsRouter } from "./routes/settings.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { createTelegramWebhookRouter } from "./routes/telegramWebhook.js";
import { createGoogleConnectRouter, createGoogleCallbackRouter, type GoogleOAuthRouterConfig } from "./routes/google.js";
import { createApprovalsRouter } from "./routes/approvals.js";
import { memoriesRouter } from "./routes/memories.js";
import { createScheduledTasksRouter } from "./routes/scheduledTasks.js";
import { loginRateLimit, taskCreationRateLimit } from "./middleware/rateLimit.js";

type SchedulerQueue = Pick<Queue<ScheduledJobData>, "upsertJobScheduler" | "removeJobScheduler" | "getJob" | "add" | "remove">;

export interface CreateAppOptions {
  modelProvider?: ModelProvider;
  taskQueue?: Pick<Queue<AgentTaskJobData>, "add">;
  schedulerQueue?: SchedulerQueue;
  telegramClient?: TelegramClient;
  telegramBotUsername?: string;
  telegramWebhookSecret?: string;
  googleOAuth?: GoogleOAuthConfig;
  encryptionMasterKey?: string;
}

function resolveGoogleConfig(options: CreateAppOptions): GoogleOAuthRouterConfig {
  const oauth =
    options.googleOAuth ??
    (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI }
      : undefined);
  const encryptionMasterKey = options.encryptionMasterKey ?? env.ENCRYPTION_MASTER_KEY;
  return { oauth, encryptionMasterKey };
}

export function createApp(options: CreateAppOptions = {}): Express {
  const modelProvider = options.modelProvider ?? createModelProvider(env.AI_PROVIDER);
  const taskQueue = options.taskQueue ?? createAgentTaskQueue(bullRedisConnection);
  const schedulerQueue = options.schedulerQueue ?? createScheduledTaskQueue(bullRedisConnection);
  const telegramClient =
    options.telegramClient ?? (env.TELEGRAM_BOT_TOKEN ? createTelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined);
  const googleConfig = resolveGoogleConfig(options);

  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(sessionMiddleware);
  app.use(csrfHeaderCheck);

  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/v1/health/ready", async (_req, res) => {
    const checks: Record<string, "ok" | "error"> = { database: "error", redis: "error" };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch (error) {
      logger.error({ err: error }, "database readiness check failed");
    }

    try {
      if (redis.status === "wait" || redis.status === "end") {
        await redis.connect();
      }
      await redis.ping();
      checks.redis = "ok";
    } catch (error) {
      logger.error({ err: error }, "redis readiness check failed");
    }

    const allOk = Object.values(checks).every((status) => status === "ok");
    res.status(allOk ? 200 : 503).json({ status: allOk ? "ready" : "not_ready", checks });
  });

  app.use("/api/v1/auth/login", loginRateLimit);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/conversations", requireAuth, createConversationsRouter(modelProvider));
  app.use("/api/v1/settings", requireAuth, settingsRouter);
  app.use("/api/v1/tasks", requireAuth, taskCreationRateLimit, createTasksRouter(taskQueue));
  app.use("/api/v1/integrations/google/connect", requireAuth, createGoogleConnectRouter(googleConfig));
  app.use("/api/v1/integrations/google/callback", createGoogleCallbackRouter(googleConfig));
  app.use("/api/v1/integrations", requireAuth, createIntegrationsRouter(options.telegramBotUsername));
  app.use("/api/v1/approvals", requireAuth, createApprovalsRouter(taskQueue));
  app.use("/api/v1/memories", requireAuth, memoriesRouter);
  app.use("/api/v1/scheduled-tasks", requireAuth, createScheduledTasksRouter(schedulerQueue));

  // Inactive until a public URL is registered with Telegram — see
  // docs/risk-register.md #5. Local dev uses long-polling (apps/worker)
  // instead, sharing the same processUpdate handler.
  if (telegramClient) {
    const webhookSecret = options.telegramWebhookSecret ?? env.TELEGRAM_WEBHOOK_SECRET;
    app.use("/webhooks/telegram", createTelegramWebhookRouter({ client: telegramClient, taskQueue }, webhookSecret));
  }

  return app;
}
