import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@jarvis/database";
import { notifyTaskResult } from "./notify.js";
import type { TelegramClient } from "./types.js";

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

function fakeClient() {
  const sendMessage = vi.fn(async (_params: { chatId: number | string; text: string }) => {});
  const client: TelegramClient = {
    getMe: vi.fn(async () => ({ id: 1, is_bot: true, first_name: "Jarvis" })),
    getUpdates: vi.fn(async () => []),
    sendMessage,
  };
  return { client, sendMessage };
}

describe("notifyTaskResult", () => {
  it("sends a completion message for a Telegram-originated task with a connected integration", async () => {
    const user = await makeUser();
    const chatId = Math.floor(Math.random() * 1_000_000_000);
    await prisma.integration.create({
      data: { userId: user.id, provider: "telegram", status: "connected", externalId: String(chatId) },
    });
    const conversation = await prisma.conversation.create({ data: { userId: user.id, channel: "TELEGRAM" } });
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        goal: "g",
        status: "COMPLETED",
        resultSummary: "all done",
        limits: {},
      },
    });

    const { client, sendMessage } = fakeClient();
    await notifyTaskResult(task.id, client);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toEqual({ chatId, text: expect.stringContaining("all done") });
  });

  it("does not notify a web-originated task", async () => {
    const user = await makeUser();
    const conversation = await prisma.conversation.create({ data: { userId: user.id, channel: "WEB" } });
    const task = await prisma.task.create({
      data: { userId: user.id, conversationId: conversation.id, goal: "g", status: "COMPLETED", limits: {} },
    });

    const { client, sendMessage } = fakeClient();
    await notifyTaskResult(task.id, client);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not notify when there is no connected Telegram integration", async () => {
    const user = await makeUser();
    const conversation = await prisma.conversation.create({ data: { userId: user.id, channel: "TELEGRAM" } });
    const task = await prisma.task.create({
      data: { userId: user.id, conversationId: conversation.id, goal: "g", status: "FAILED", limits: {} },
    });

    const { client, sendMessage } = fakeClient();
    await notifyTaskResult(task.id, client);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
