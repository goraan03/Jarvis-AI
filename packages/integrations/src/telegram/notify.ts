import { prisma } from "@jarvis/database";
import type { TelegramClient } from "./types.js";
import { shortId } from "./handler.js";

function buildResultText(task: { id: string; status: string; resultSummary: string | null; failureReason: string | null }): string {
  const id = shortId(task.id);
  switch (task.status) {
    case "COMPLETED":
      return `✅ Task ${id} finished:\n${task.resultSummary ?? "(no summary)"}`;
    case "FAILED":
      return `❌ Task ${id} failed: ${task.failureReason ?? "unknown error"}`;
    case "CANCELLED":
      return `🚫 Task ${id} was cancelled.`;
    default:
      return `Task ${id} is now ${task.status}.`;
  }
}

/**
 * Called from apps/worker after a BullMQ job finishes. Only sends a
 * message when the task actually originated from a linked Telegram
 * chat — web-originated tasks never produce a Telegram notification.
 */
export async function notifyTaskResult(taskId: string, client: TelegramClient): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { conversation: true } });
  if (!task || task.conversation?.channel !== "TELEGRAM") {
    return;
  }

  const integration = await prisma.integration.findFirst({
    where: { userId: task.userId, provider: "telegram", status: "connected" },
  });
  if (!integration?.externalId) {
    return;
  }

  await client.sendMessage({ chatId: Number(integration.externalId), text: buildResultText(task) });
}
