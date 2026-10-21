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
 * If the task paused for approval, sends the approve/reject buttons
 * instead of a plain status line.
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
  const chatId = Number(integration.externalId);

  if (task.status === "AWAITING_APPROVAL") {
    const approval = await prisma.approvalRequest.findFirst({
      where: { taskId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (approval) {
      await client.sendMessage({
        chatId,
        text: `⏸ Approval needed for "${approval.toolName}":\n${JSON.stringify(approval.boundInput, null, 2)}`,
        inlineKeyboard: [
          [
            { text: "✅ Approve", callback_data: `approval:${approval.id}:approve` },
            { text: "❌ Reject", callback_data: `approval:${approval.id}:reject` },
          ],
        ],
      });
      return;
    }
  }

  await client.sendMessage({ chatId, text: buildResultText(task) });
}
