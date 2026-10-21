import { Router, type Request, type Response } from "express";
import type { Queue } from "bullmq";
import { prisma } from "@jarvis/database";
import { decideApproval, ApprovalNotFoundError, ApprovalAlreadyDecidedError, type AgentTaskJobData } from "@jarvis/ai-engine";

export function createApprovalsRouter(taskQueue: Pick<Queue<AgentTaskJobData>, "add">) {
  const router = Router();

  router.get("/", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
    const approvals = await prisma.approvalRequest.findMany({
      where: { userId: req.user!.id, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ data: approvals });
  });

  router.get("/:id", async (req, res) => {
    const approval = await prisma.approvalRequest.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!approval) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Approval request not found." } });
      return;
    }
    res.json(approval);
  });

  async function handleDecision(req: Request, res: Response, decision: "APPROVED" | "REJECTED") {
    try {
      const approval = await decideApproval(String(req.params.id), decision, req.user!.id, taskQueue);
      res.json(approval);
    } catch (error) {
      if (error instanceof ApprovalNotFoundError) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: error.message } });
        return;
      }
      if (error instanceof ApprovalAlreadyDecidedError) {
        res.status(400).json({ error: { code: "ALREADY_DECIDED", message: error.message } });
        return;
      }
      throw error;
    }
  }

  router.post("/:id/approve", (req, res) => handleDecision(req, res, "APPROVED"));
  router.post("/:id/reject", (req, res) => handleDecision(req, res, "REJECTED"));

  return router;
}
