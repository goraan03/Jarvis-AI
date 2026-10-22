import { Router } from "express";
import { prisma } from "@jarvis/database";
import { createLinkCode, disconnectGoogle } from "@jarvis/integrations";
import { writeAuditLog } from "@jarvis/security";

export function createIntegrationsRouter(telegramBotUsername?: string) {
  const router = Router();

  router.get("/", async (req, res) => {
    const integrations = await prisma.integration.findMany({ where: { userId: req.user!.id } });
    res.json({
      data: integrations.map((i) => ({
        provider: i.provider,
        status: i.status,
        externalId: i.externalId,
        metadata: i.metadata,
        updatedAt: i.updatedAt,
      })),
    });
  });

  router.post("/telegram/link-code", async (req, res) => {
    const { code, expiresAt } = await createLinkCode(req.user!.id);
    res.status(201).json({
      code,
      expiresAt,
      deepLink: telegramBotUsername ? `https://t.me/${telegramBotUsername}?start=${code}` : null,
    });
  });

  router.delete("/telegram", async (req, res) => {
    const existing = await prisma.integration.findUnique({
      where: { userId_provider: { userId: req.user!.id, provider: "telegram" } },
    });
    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Telegram is not connected." } });
      return;
    }
    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: { status: "disconnected", externalId: null },
    });
    await writeAuditLog({ userId: req.user!.id, action: "integration.disconnect", entityType: "Integration", entityId: "telegram", metadata: { provider: "telegram" } });
    res.json({ provider: updated.provider, status: updated.status });
  });

  router.delete("/google", async (req, res) => {
    const disconnected = await disconnectGoogle(req.user!.id);
    if (!disconnected) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Google is not connected." } });
      return;
    }
    await writeAuditLog({ userId: req.user!.id, action: "integration.disconnect", entityType: "Integration", entityId: "google", metadata: { provider: "google" } });
    res.json({ provider: "google", status: "disconnected" });
  });

  return router;
}
