import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jarvis/database";
import {
  createAndEnqueueTask,
  cancelPendingApprovalsForTask,
  ConcurrentTaskLimitError,
  SettingsNotFoundError,
  type AgentTaskJobData,
} from "@jarvis/ai-engine";
import type { Queue } from "bullmq";

const createTaskSchema = z.object({
  goal: z.string().min(1).max(5000),
});

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

export function createTasksRouter(taskQueue: Pick<Queue<AgentTaskJobData>, "add">) {
  const router = Router();

  router.get("/", async (req, res) => {
    const tasks = await prisma.task.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ data: tasks });
  });

  router.post("/", async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A non-empty goal is required." } });
      return;
    }

    try {
      const task = await createAndEnqueueTask(taskQueue, { userId: req.user!.id, goal: parsed.data.goal });
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof ConcurrentTaskLimitError) {
        res.status(429).json({ error: { code: "TOO_MANY_CONCURRENT_TASKS", message: error.message } });
        return;
      }
      if (error instanceof SettingsNotFoundError) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Settings not found for this user." } });
        return;
      }
      throw error;
    }
  });

  router.get("/:id", async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        steps: { orderBy: { stepIndex: "asc" } },
        toolExecutions: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!task) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    res.json(task);
  });

  router.post("/:id/cancel", async (req, res) => {
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!task) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    if ((TERMINAL_STATUSES as readonly string[]).includes(task.status)) {
      res.status(400).json({ error: { code: "ALREADY_FINISHED", message: `Task is already ${task.status}.` } });
      return;
    }
    const cancelled = await prisma.task.update({
      where: { id: task.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await cancelPendingApprovalsForTask(task.id);
    res.json(cancelled);
  });

  return router;
}
