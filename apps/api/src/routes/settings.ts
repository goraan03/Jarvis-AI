import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jarvis/database";

const updateSettingsSchema = z.object({
  defaultModel: z.string().min(1).optional(),
  maxToolCallsPerTask: z.number().int().positive().optional(),
  maxModelCallsPerTask: z.number().int().positive().optional(),
  maxTaskDurationMs: z.number().int().positive().optional(),
  maxTokensPerTask: z.number().int().positive().optional(),
  maxCostMicroUsdPerTask: z.number().int().positive().optional(),
  maxConcurrentTasks: z.number().int().positive().optional(),
  autoMemoryEnabled: z.boolean().optional(),
});

export const settingsRouter = Router();

settingsRouter.get("/", async (req, res) => {
  const settings = await prisma.agentSettings.findUnique({ where: { userId: req.user!.id } });
  if (!settings) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Settings not found for this user." } });
    return;
  }
  res.json(settings);
});

settingsRouter.patch("/", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid settings payload." } });
    return;
  }
  const settings = await prisma.agentSettings.update({
    where: { userId: req.user!.id },
    data: parsed.data,
  });
  res.json(settings);
});
