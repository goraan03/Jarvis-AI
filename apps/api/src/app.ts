import express, { type Express } from "express";
import helmet from "helmet";
import { prisma } from "@jarvis/database";
import { redis } from "./redis.js";
import { logger } from "./logger.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

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

  return app;
}
