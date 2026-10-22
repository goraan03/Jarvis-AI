import { Router } from "express";
import { prisma } from "@jarvis/database";

export const usageRouter = Router();

usageRouter.get("/", async (req, res) => {
  const { from, to } = req.query;

  const where: Record<string, unknown> = { userId: req.user!.id };
  if (typeof from === "string" || typeof to === "string") {
    const createdAt: Record<string, Date> = {};
    if (typeof from === "string") {
      const parsed = new Date(from);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid 'from' date." } });
        return;
      }
      createdAt.gte = parsed;
    }
    if (typeof to === "string") {
      const parsed = new Date(to);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid 'to' date." } });
        return;
      }
      createdAt.lte = parsed;
    }
    where.createdAt = createdAt;
  }

  const records = await prisma.usageRecord.findMany({ where, orderBy: { createdAt: "asc" } });

  const totals = { inputTokens: 0, outputTokens: 0, estimatedCostMicroUsd: 0, callCount: 0 };
  const byDayMap = new Map<string, typeof totals>();
  for (const record of records) {
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.estimatedCostMicroUsd += record.estimatedCostMicroUsd;
    totals.callCount += 1;

    const day = record.createdAt.toISOString().slice(0, 10);
    const bucket = byDayMap.get(day) ?? { inputTokens: 0, outputTokens: 0, estimatedCostMicroUsd: 0, callCount: 0 };
    bucket.inputTokens += record.inputTokens;
    bucket.outputTokens += record.outputTokens;
    bucket.estimatedCostMicroUsd += record.estimatedCostMicroUsd;
    bucket.callCount += 1;
    byDayMap.set(day, bucket);
  }

  const byDay = [...byDayMap.entries()]
    .map(([date, totals]) => ({ date, ...totals }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({ totals, byDay });
});
