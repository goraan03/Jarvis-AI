import type { Queue } from "bullmq";
import { prisma, Prisma } from "@jarvis/database";
import {
  createAndEnqueueTask,
  decideApproval,
  cancelPendingApprovalsForTask,
  ConcurrentTaskLimitError,
  ApprovalNotFoundError,
  ApprovalAlreadyDecidedError,
  type AgentTaskJobData,
} from "@jarvis/ai-engine";
import type { TelegramCallbackQuery, TelegramClient, TelegramUpdate } from "./types.js";
import { consumeLinkCode, findUserByTelegramChatId, getTelegramConversationIdIfConnected } from "./linking.js";

export interface TelegramHandlerDeps {
  client: TelegramClient;
  taskQueue: Pick<Queue<AgentTaskJobData>, "add">;
}

const ACTIVE_STATUSES = ["PENDING", "PLANNING", "RUNNING", "AWAITING_APPROVAL"] as const;

export function shortId(id: string): string {
  return id.slice(0, 8);
}

async function handleTasksCommand(deps: TelegramHandlerDeps, chatId: number, userId: string) {
  const tasks = await prisma.task.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5 });
  if (tasks.length === 0) {
    await deps.client.sendMessage({ chatId, text: "No tasks yet. Just send me a message to start one." });
    return;
  }
  const lines = tasks.map((t) => `• [${t.status}] ${t.goal} (id: ${shortId(t.id)})`);
  await deps.client.sendMessage({ chatId, text: lines.join("\n") });
}

async function handleCancelCommand(deps: TelegramHandlerDeps, chatId: number, userId: string, shortTaskId: string) {
  const task = await prisma.task.findFirst({ where: { userId, id: { startsWith: shortTaskId } } });
  if (!task) {
    await deps.client.sendMessage({ chatId, text: `No task found matching "${shortTaskId}".` });
    return;
  }
  if (!(ACTIVE_STATUSES as readonly string[]).includes(task.status)) {
    await deps.client.sendMessage({ chatId, text: `Task ${shortId(task.id)} is already ${task.status}.` });
    return;
  }
  await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELLED", completedAt: new Date() } });
  await cancelPendingApprovalsForTask(task.id);
  await deps.client.sendMessage({ chatId, text: `Cancelled task ${shortId(task.id)}.` });
}

async function handleNewTaskGoal(deps: TelegramHandlerDeps, chatId: number, userId: string, goal: string) {
  const conversationId = await getTelegramConversationIdIfConnected(userId);
  try {
    const task = await createAndEnqueueTask(deps.taskQueue, { userId, goal, conversationId: conversationId ?? undefined });
    await deps.client.sendMessage({ chatId, text: `⏳ Working on it (task ${shortId(task.id)}): ${goal}` });
  } catch (error) {
    if (error instanceof ConcurrentTaskLimitError) {
      await deps.client.sendMessage({ chatId, text: `⚠️ ${error.message}` });
      return;
    }
    throw error;
  }
}

async function handleCallbackQuery(deps: TelegramHandlerDeps, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const data = callbackQuery.data ?? "";
  const match = /^approval:([^:]+):(approve|reject)$/.exec(data);
  if (!match) {
    await deps.client.answerCallbackQuery({ callbackQueryId: callbackQuery.id });
    return;
  }
  const [, approvalId, action] = match;

  const userId = await findUserByTelegramChatId(callbackQuery.from.id);
  if (!userId) {
    await deps.client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Not linked." });
    return;
  }

  try {
    await decideApproval(approvalId, action === "approve" ? "APPROVED" : "REJECTED", userId, deps.taskQueue);
    await deps.client.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: action === "approve" ? "Approved." : "Rejected.",
    });
    if (callbackQuery.message) {
      await deps.client.sendMessage({
        chatId: callbackQuery.message.chat.id,
        text: action === "approve" ? "✅ Approved — resuming the task." : "❌ Rejected.",
      });
    }
  } catch (error) {
    if (error instanceof ApprovalNotFoundError || error instanceof ApprovalAlreadyDecidedError) {
      await deps.client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: error.message, showAlert: true });
      return;
    }
    throw error;
  }
}

/**
 * Processes one Telegram update, idempotently. Safe to call more than
 * once with the same update (webhook retries, a restarted poll loop) —
 * the second call is a guaranteed no-op, verified by
 * docs/security-model.md §9 and this phase's tests.
 */
export async function processUpdate(update: TelegramUpdate, deps: TelegramHandlerDeps): Promise<void> {
  try {
    await prisma.telegramUpdate.create({ data: { updateId: BigInt(update.update_id) } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return; // already processed this update_id — no-op, by design
    }
    throw error;
  }

  if (update.callback_query) {
    await handleCallbackQuery(deps, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.text) {
    return;
  }
  if (message.chat.type !== "private") {
    return; // never respond in groups — docs/security-model.md §10
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith("/start") || text.startsWith("/link")) {
    const code = text.split(/\s+/)[1];
    if (!code) {
      await deps.client.sendMessage({
        chatId,
        text: "Send /start <code> with the code shown in the Jarvis web app under Integrations.",
      });
      return;
    }
    const result = await consumeLinkCode(code.toUpperCase(), chatId, {
      username: message.from?.username,
      firstName: message.from?.first_name ?? "there",
    });
    await deps.client.sendMessage({
      chatId,
      text:
        result.outcome === "linked"
          ? "✅ Linked! You can now send me anything and I'll turn it into a task."
          : "That code is invalid or expired. Generate a new one from the Jarvis web app.",
    });
    return;
  }

  const userId = await findUserByTelegramChatId(chatId);
  if (!userId) {
    await deps.client.sendMessage({
      chatId,
      text: "This Telegram account isn't linked to a Jarvis account. Open the web app's Integrations page for a linking code.",
    });
    return;
  }

  if (text === "/tasks") {
    await handleTasksCommand(deps, chatId, userId);
    return;
  }
  if (text.startsWith("/cancel")) {
    const id = text.split(/\s+/)[1];
    if (!id) {
      await deps.client.sendMessage({ chatId, text: "Usage: /cancel <task id>" });
      return;
    }
    await handleCancelCommand(deps, chatId, userId, id);
    return;
  }
  if (text === "/help") {
    await deps.client.sendMessage({
      chatId,
      text: "Send me anything to start a task. /tasks lists recent tasks. /cancel <id> cancels one.",
    });
    return;
  }

  await handleNewTaskGoal(deps, chatId, userId, text);
}
