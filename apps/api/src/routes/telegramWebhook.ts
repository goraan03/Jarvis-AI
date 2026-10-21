import { Router } from "express";
import type { TelegramHandlerDeps } from "@jarvis/integrations";
import { processUpdate } from "@jarvis/integrations";
import { logger } from "../logger.js";

/**
 * Inactive in local development (we use long-polling in apps/worker
 * instead — docs/risk-register.md #5) but implemented and secured now so
 * a future deployment only needs to register the webhook URL with
 * Telegram, not write new code. Fails closed: no configured secret means
 * no request is ever accepted.
 */
export function createTelegramWebhookRouter(deps: TelegramHandlerDeps, webhookSecret: string | undefined) {
  const router = Router();

  router.post("/", async (req, res) => {
    if (!webhookSecret || req.header("x-telegram-bot-api-secret-token") !== webhookSecret) {
      res.status(401).end();
      return;
    }
    try {
      await processUpdate(req.body, deps);
    } catch (error) {
      logger.error({ err: error }, "telegram webhook processing failed");
    }
    res.status(200).end();
  });

  return router;
}
