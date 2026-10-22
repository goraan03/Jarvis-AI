import { Router } from "express";
import { prisma } from "@jarvis/database";

export const auditLogRouter = Router();

auditLogRouter.get("/", async (req, res) => {
  const { from, to, action } = req.query;

  const where: Record<string, unknown> = { userId: req.user!.id };
  if (typeof action === "string" && action) {
    where.action = action;
  }
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

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data: entries });
});
