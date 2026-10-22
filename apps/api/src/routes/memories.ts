import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jarvis/database";

const MEMORY_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "ARCHIVED"] as const;

const createMemorySchema = z.object({
  category: z.string().min(1).max(100),
  content: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).optional().default(1),
});

const updateMemorySchema = z.object({
  category: z.string().min(1).max(100).optional(),
  content: z.string().min(1).max(2000).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
});

interface MemorySearchRow {
  id: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export const memoriesRouter = Router();

memoriesRouter.get("/export", async (req, res) => {
  const memories = await prisma.memory.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "asc" } });
  res.setHeader("Content-Disposition", 'attachment; filename="jarvis-memory-export.json"');
  res.json({ exportedAt: new Date().toISOString(), userId: req.user!.id, memories });
});

memoriesRouter.get("/", async (req, res) => {
  const statusParam = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  if (statusParam && !(MEMORY_STATUSES as readonly string[]).includes(statusParam)) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Invalid status. Use one of: ${MEMORY_STATUSES.join(", ")}.` } });
    return;
  }
  const query = typeof req.query.q === "string" ? req.query.q : undefined;

  if (query) {
    const effectiveStatus = statusParam ?? "APPROVED";
    const rows = await prisma.$queryRaw<MemorySearchRow[]>(
      Prisma.sql`
        SELECT id, category, content, source, confidence, status, "createdAt", "updatedAt"
        FROM "Memory"
        WHERE "userId" = ${req.user!.id}
          AND status = ${effectiveStatus}::"MemoryStatus"
          AND "searchVector" @@ plainto_tsquery('english', ${query})
        ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${query})) DESC
        LIMIT 50
      `,
    );
    res.json({ data: rows });
    return;
  }

  const memories = await prisma.memory.findMany({
    where: { userId: req.user!.id, ...(statusParam ? { status: statusParam as never } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ data: memories });
});

memoriesRouter.post("/", async (req, res) => {
  const parsed = createMemorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "category and content are required." } });
    return;
  }
  const memory = await prisma.memory.create({
    data: { userId: req.user!.id, ...parsed.data, source: "manual", status: "APPROVED" },
  });
  res.status(201).json(memory);
});

memoriesRouter.patch("/:id", async (req, res) => {
  const parsed = updateMemorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid memory update." } });
    return;
  }
  const existing = await prisma.memory.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Memory not found." } });
    return;
  }
  const updated = await prisma.memory.update({ where: { id: existing.id }, data: parsed.data });
  res.json(updated);
});

memoriesRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.memory.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Memory not found." } });
    return;
  }
  await prisma.memory.delete({ where: { id: existing.id } });
  res.status(204).end();
});
