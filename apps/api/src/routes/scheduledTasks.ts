import { Router } from "express";
import { z } from "zod";
import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import {
  createScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  cancelScheduledTask,
  updateScheduledTask,
  triggerScheduledTaskNow,
  ScheduledTaskNotFoundError,
  InvalidScheduleError,
  type ScheduledJobData,
} from "@jarvis/scheduler";

type SchedulerQueue = Pick<Queue<ScheduledJobData>, "upsertJobScheduler" | "removeJobScheduler" | "getJob" | "add" | "remove">;

const payloadSchema = z.object({ goal: z.string().min(1).max(5000) });

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    timezone: z.string().min(1),
    payload: payloadSchema,
    cronExpression: z.string().min(1).optional(),
    runAt: z.string().datetime().optional(),
  })
  .refine((v) => Boolean(v.cronExpression) !== Boolean(v.runAt), {
    message: "Provide exactly one of cronExpression or runAt.",
  });

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).optional(),
  payload: payloadSchema.optional(),
  cronExpression: z.string().min(1).nullable().optional(),
  runAt: z.string().datetime().nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

function handleSchedulerError(error: unknown, res: import("express").Response): boolean {
  if (error instanceof ScheduledTaskNotFoundError) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: error.message } });
    return true;
  }
  if (error instanceof InvalidScheduleError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: error.message } });
    return true;
  }
  return false;
}

export function createScheduledTasksRouter(queue: SchedulerQueue) {
  const router = Router();

  router.get("/", async (req, res) => {
    const tasks = await prisma.scheduledTask.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } });
    res.json({ data: tasks });
  });

  router.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide exactly one of cronExpression or runAt." } });
      return;
    }
    try {
      const task = await createScheduledTask(queue, {
        userId: req.user!.id,
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        payload: parsed.data.payload,
        cronExpression: parsed.data.cronExpression,
        runAt: parsed.data.runAt ? new Date(parsed.data.runAt) : undefined,
      });
      res.status(201).json(task);
    } catch (error) {
      if (handleSchedulerError(error, res)) return;
      throw error;
    }
  });

  router.get("/:id", async (req, res) => {
    const task = await prisma.scheduledTask.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!task) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Scheduled task not found." } });
      return;
    }
    res.json(task);
  });

  router.get("/:id/runs", async (req, res) => {
    const task = await prisma.scheduledTask.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!task) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Scheduled task not found." } });
      return;
    }
    const runs = await prisma.scheduledTaskRun.findMany({ where: { scheduledTaskId: task.id }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ data: runs });
  });

  router.patch("/:id", async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid scheduled task update." } });
      return;
    }
    try {
      if (parsed.data.status === "paused") {
        res.json(await pauseScheduledTask(queue, req.params.id, req.user!.id));
        return;
      }
      if (parsed.data.status === "active") {
        res.json(await resumeScheduledTask(queue, req.params.id, req.user!.id));
        return;
      }
      const { name, timezone, payload, cronExpression, runAt } = parsed.data;
      const updated = await updateScheduledTask(queue, req.params.id, req.user!.id, {
        name,
        timezone,
        payload,
        cronExpression,
        runAt: runAt === null ? null : runAt ? new Date(runAt) : undefined,
      });
      res.json(updated);
    } catch (error) {
      if (handleSchedulerError(error, res)) return;
      throw error;
    }
  });

  router.post("/:id/trigger", async (req, res) => {
    try {
      await triggerScheduledTaskNow(queue, req.params.id, req.user!.id);
      res.status(202).json({ triggered: true });
    } catch (error) {
      if (handleSchedulerError(error, res)) return;
      throw error;
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const cancelled = await cancelScheduledTask(queue, req.params.id, req.user!.id);
      res.json(cancelled);
    } catch (error) {
      if (handleSchedulerError(error, res)) return;
      throw error;
    }
  });

  return router;
}
