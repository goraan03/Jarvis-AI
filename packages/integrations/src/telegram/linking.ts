import { randomBytes } from "node:crypto";
import { prisma } from "@jarvis/database";

const LINK_CODE_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  // 6 chars, base32-ish alphabet, easy to type on a phone keyboard.
  return randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

export interface LinkCode {
  code: string;
  expiresAt: Date;
}

/** Issues a fresh one-time code for the owner to send to the bot. Replaces any unused prior code for this user. */
export async function createLinkCode(userId: string): Promise<LinkCode> {
  await prisma.telegramLinkCode.deleteMany({ where: { userId } });
  const code = generateCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  await prisma.telegramLinkCode.create({ data: { code, userId, expiresAt } });
  return { code, expiresAt };
}

export type LinkResult =
  | { outcome: "linked"; userId: string }
  | { outcome: "invalid_or_expired" };

/**
 * Consumes a code sent from Telegram and binds the sending chat to the
 * owning user. Single-use: the code row is deleted whether or not it was
 * valid, so a leaked/guessed code can't be retried indefinitely.
 */
export async function consumeLinkCode(code: string, chatId: number, telegramUser: { username?: string; firstName: string }): Promise<LinkResult> {
  const record = await prisma.telegramLinkCode.findUnique({ where: { code } });
  if (record) {
    await prisma.telegramLinkCode.delete({ where: { code } });
  }
  if (!record || record.expiresAt < new Date()) {
    return { outcome: "invalid_or_expired" };
  }

  await prisma.integration.upsert({
    where: { userId_provider: { userId: record.userId, provider: "telegram" } },
    create: {
      userId: record.userId,
      provider: "telegram",
      status: "connected",
      externalId: String(chatId),
      metadata: { username: telegramUser.username, firstName: telegramUser.firstName },
    },
    update: {
      status: "connected",
      externalId: String(chatId),
      metadata: { username: telegramUser.username, firstName: telegramUser.firstName },
    },
  });

  return { outcome: "linked", userId: record.userId };
}

/** Resolves an inbound chat id to the owning user, or null if unlinked. */
export async function findUserByTelegramChatId(chatId: number): Promise<string | null> {
  const integration = await prisma.integration.findFirst({
    where: { provider: "telegram", externalId: String(chatId), status: "connected" },
  });
  return integration?.userId ?? null;
}

/**
 * Finds (or creates) this user's Telegram conversation, but only if they
 * actually have a connected Telegram account — used to attach scheduled
 * tasks to Telegram so their results/failures reuse the existing
 * notifyTaskResult hook with no new notification code.
 */
export async function getTelegramConversationIdIfConnected(userId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: "telegram" } },
  });
  if (integration?.status !== "connected") {
    return null;
  }
  const existing = await prisma.conversation.findFirst({ where: { userId, channel: "TELEGRAM" } });
  if (existing) return existing.id;
  const created = await prisma.conversation.create({ data: { userId, channel: "TELEGRAM", title: "Telegram" } });
  return created.id;
}
