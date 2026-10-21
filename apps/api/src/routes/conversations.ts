import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jarvis/database";
import type { ModelProvider } from "@jarvis/ai-engine";
import { logger } from "../logger.js";

const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

const createMessageSchema = z.object({
  content: z.string().min(1).max(20000),
});

// MockProvider never costs real money. A real per-token price table arrives
// with the Anthropic provider, not before — docs/architecture.md §6.
const MOCK_COST_MICRO_USD = 0;

export function createConversationsRouter(modelProvider: ModelProvider) {
  const router = Router();

  router.get("/", async (req, res) => {
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    res.json({ data: conversations });
  });

  router.post("/", async (req, res) => {
    const parsed = createConversationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid conversation payload." } });
      return;
    }
    const conversation = await prisma.conversation.create({
      data: { userId: req.user!.id, title: parsed.data.title },
    });
    res.status(201).json(conversation);
  });

  router.get("/:id", async (req, res) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found." } });
      return;
    }
    res.json(conversation);
  });

  router.post("/:id/messages", async (req, res) => {
    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Message content is required." } });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Conversation not found." } });
      return;
    }

    const userMessage = await prisma.message.create({
      data: { conversationId: conversation.id, role: "USER", content: parsed.data.content },
    });

    const settings = await prisma.agentSettings.findUnique({ where: { userId: req.user!.id } });
    const model = settings?.defaultModel ?? "claude-sonnet-5";

    let assistantMessage;
    try {
      const completion = await modelProvider.complete({
        model,
        messages: [
          ...conversation.messages.map((m) => ({
            role: m.role.toLowerCase() as "user" | "assistant" | "system",
            content: m.content,
          })),
          { role: "user" as const, content: parsed.data.content },
        ],
      });

      assistantMessage = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: conversation.id,
            role: "ASSISTANT",
            content: completion.content,
            providerUsed: completion.provider,
          },
        });
        await tx.usageRecord.create({
          data: {
            userId: req.user!.id,
            conversationId: conversation.id,
            provider: completion.provider,
            model: completion.model,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            estimatedCostMicroUsd: MOCK_COST_MICRO_USD,
          },
        });
        await tx.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
        return message;
      });
    } catch (error) {
      logger.error({ err: error }, "model provider call failed");
      res.status(502).json({
        error: { code: "PROVIDER_ERROR", message: "The model provider failed to respond." },
        data: { userMessage },
      });
      return;
    }

    res.status(201).json({ userMessage, assistantMessage });
  });

  return router;
}
