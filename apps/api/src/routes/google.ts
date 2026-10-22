import { Router } from "express";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  saveGoogleCredential,
  createOAuthState,
  consumeOAuthState,
  type GoogleOAuthConfig,
} from "@jarvis/integrations";
import { writeAuditLog } from "@jarvis/security";
import { logger } from "../logger.js";

export interface GoogleOAuthRouterConfig {
  oauth?: GoogleOAuthConfig;
  encryptionMasterKey?: string;
}

const PROVIDER = "google";

export function createGoogleConnectRouter(config: GoogleOAuthRouterConfig) {
  const router = Router();

  router.get("/", async (req, res) => {
    if (!config.oauth || !config.encryptionMasterKey) {
      res.status(501).json({
        error: {
          code: "NOT_CONFIGURED",
          message: "Google isn't configured on the server yet. Set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI and ENCRYPTION_MASTER_KEY.",
        },
      });
      return;
    }
    const state = await createOAuthState(req.user!.id, PROVIDER);
    res.redirect(buildGoogleAuthUrl(config.oauth, state));
  });

  return router;
}

export function createGoogleCallbackRouter(config: GoogleOAuthRouterConfig) {
  const router = Router();

  router.get("/", async (req, res) => {
    if (!config.oauth || !config.encryptionMasterKey) {
      res.status(501).send("Google isn't configured on the server.");
      return;
    }

    const { code, state, error } = req.query;
    if (typeof error === "string") {
      res.status(400).send(`Google OAuth error: ${error}`);
      return;
    }
    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).send("Missing code or state.");
      return;
    }

    const userId = await consumeOAuthState(state, PROVIDER);
    if (!userId) {
      res.status(400).send("Invalid or expired OAuth state. Start the connection again from the Integrations page.");
      return;
    }

    try {
      const tokens = await exchangeGoogleCode(config.oauth, code);
      await saveGoogleCredential(userId, tokens.refreshToken, tokens.email, config.encryptionMasterKey);
      await writeAuditLog({ userId, action: "integration.connect", entityType: "Integration", entityId: "google", metadata: { provider: "google" } });
      res.redirect("/integrations?google=connected");
    } catch (err) {
      logger.error({ err }, "google oauth callback failed");
      res.status(502).send("Failed to connect your Google account. Please try again.");
    }
  });

  return router;
}
