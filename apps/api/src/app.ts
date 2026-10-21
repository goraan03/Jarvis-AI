import express, { type Express } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { prisma } from "@jarvis/database";
import { createModelProvider, type ModelProvider } from "@jarvis/ai-engine";
import { redis } from "./redis.js";
import { logger } from "./logger.js";
import { env } from "./env.js";
import { sessionMiddleware, requireAuth } from "./auth/session.js";
import { csrfHeaderCheck } from "./auth/csrf.js";
import { authRouter } from "./routes/auth.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { settingsRouter } from "./routes/settings.js";
import { loginRateLimit } from "./middleware/rateLimit.js";

export interface CreateAppOptions {
  modelProvider?: ModelProvider;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const modelProvider = options.modelProvider ?? createModelProvider(env.AI_PROVIDER);

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

  return app;
}
