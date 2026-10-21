import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@jarvis/database";
import { processUpdate } from "./handler.js";
import { createLinkCode } from "./linking.js";
import type { TelegramClient, TelegramUpdate } from "./types.js";

// Randomized base per test run (not a fixed constant) so update_id never
// collides with rows left over in the shared jarvis_test database by a
// previous run — TelegramUpdate rows are an idempotency ledger and are
// deliberately never cleaned up between runs.
let nextUpdateId = Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
function freshUpdateId(): number {
  return nextUpdateId++;
}

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

function fakeClient() {
  const sent: Array<{ chatId: number | string; text: string }> = [];
  const client: TelegramClient = {
    getMe: vi.fn(async () => ({ id: 1, is_bot: true, first_name: "Jarvis" })),
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(async (params) => {
      sent.push(params);
    }),
  };
  return { client, sent };
}

function fakeQueue() {
  const add = vi.fn(async (_name: string, _data: { taskId: string }, _opts?: unknown) => ({ id: "fake-job" }));
  return { add } as any;
}

function messageUpdate(chatId: number, text: string, opts: { type?: "private" | "group"; username?: string } = {}): TelegramUpdate {
  return {
    update_id: freshUpdateId(),
    message: {
      message_id: 1,
      from: { id: chatId, is_bot: false, first_name: "Owner", username: opts.username },
      chat: { id: chatId, type: opts.type ?? "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

describe("processUpdate — linking", () => {
  it("links a chat via /start <code> and acknowledges", async () => {
    const user = await makeUser();
    const { code } = await createLinkCode(user.id);
    const { client, sent } = fakeClient();
    const chatId = Math.floor(Math.random() * 1_000_000_000);

    await processUpdate(messageUpdate(chatId, `/start ${code}`, { username: "owner" }), {
      client,
      taskQueue: fakeQueue(),
    });

    expect(sent[0].text).toMatch(/linked/i);
    const integration = await prisma.integration.findUnique({
      where: { userId_provider: { userId: user.id, provider: "telegram" } },
    });
    expect(integration?.status).toBe("connected");
    expect(integration?.externalId).toBe(String(chatId));
  });

  it("rejects an invalid or expired code", async () => {
    const { client, sent } = fakeClient();
    const chatId = Math.floor(Math.random() * 1_000_000_000);

    await processUpdate(messageUpdate(chatId, "/start NOPE123"), { client, taskQueue: fakeQueue() });

    expect(sent[0].text).toMatch(/invalid or expired/i);
  });
});

describe("processUpdate — authorization", () => {
  it("rejects messages from an unlinked chat, creating no task", async () => {
    const { client, sent } = fakeClient();
    const queue = fakeQueue();
    const chatId = Math.floor(Math.random() * 1_000_000_000);

    await processUpdate(messageUpdate(chatId, "please do something"), { client, taskQueue: queue });

    expect(sent[0].text).toMatch(/isn't linked/i);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("ignores messages from non-private chats entirely", async () => {
    const user = await makeUser();
    const { code } = await createLinkCode(user.id);
    const { client, sent } = fakeClient();
    const chatId = Math.floor(Math.random() * 1_000_000_000);
    // Link via a private chat first so we know linking itself works...
    await processUpdate(messageUpdate(chatId, `/start ${code}`), { client, taskQueue: fakeQueue() });
    sent.length = 0;

    // ...then simulate the same chat id appearing in a group update (edge case).
    await processUpdate(messageUpdate(chatId, "do something", { type: "group" }), {
      client,
      taskQueue: fakeQueue(),
    });

    expect(sent).toHaveLength(0);
  });
});

describe("processUpdate — idempotency", () => {
  it("does not create a duplicate task when the same update is processed twice", async () => {
    const user = await makeUser();
    const { code } = await createLinkCode(user.id);
    const { client } = fakeClient();
    const chatId = Math.floor(Math.random() * 1_000_000_000);
    await processUpdate(messageUpdate(chatId, `/start ${code}`), { client, taskQueue: fakeQueue() });

    const queue = fakeQueue();
    const update = messageUpdate(chatId, "do the thing exactly once");

    await processUpdate(update, { client, taskQueue: queue });
    await processUpdate(update, { client, taskQueue: queue }); // same update_id, redelivered

    expect(queue.add).toHaveBeenCalledTimes(1);
    const tasks = await prisma.task.findMany({ where: { userId: user.id } });
    expect(tasks).toHaveLength(1);
  });
});

describe("processUpdate — task creation and commands", () => {
  it("creates a task from a plain message, tagged as a Telegram conversation, and acks", async () => {
    const user = await makeUser();
    const { code } = await createLinkCode(user.id);
    const { client, sent } = fakeClient();
    const chatId = Math.floor(Math.random() * 1_000_000_000);
    await processUpdate(messageUpdate(chatId, `/start ${code}`), { client, taskQueue: fakeQueue() });
    sent.length = 0;

    const queue = fakeQueue();
    await processUpdate(messageUpdate(chatId, "summarize my day"), { client, taskQueue: queue });

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(sent[0].text).toMatch(/working on it/i);

    const task = await prisma.task.findFirstOrThrow({ where: { userId: user.id }, include: { conversation: true } });
    expect(task.goal).toBe("summarize my day");
    expect(task.conversation?.channel).toBe("TELEGRAM");
  });

  it("lists tasks via /tasks and cancels via /cancel", async () => {
    const user = await makeUser();
    const { code } = await createLinkCode(user.id);
    const { client, sent } = fakeClient();
    const chatId = Math.floor(Math.random() * 1_000_000_000);
    await processUpdate(messageUpdate(chatId, `/start ${code}`), { client, taskQueue: fakeQueue() });
    sent.length = 0;

    await processUpdate(messageUpdate(chatId, "a task to cancel"), { client, taskQueue: fakeQueue() });
    const created = await prisma.task.findFirstOrThrow({ where: { userId: user.id } });
    sent.length = 0;

    await processUpdate(messageUpdate(chatId, "/tasks"), { client, taskQueue: fakeQueue() });
    expect(sent[0].text).toContain("a task to cancel");
    sent.length = 0;

    await processUpdate(messageUpdate(chatId, `/cancel ${created.id.slice(0, 8)}`), {
      client,
      taskQueue: fakeQueue(),
    });
    expect(sent[0].text).toMatch(/cancelled/i);

    const reloaded = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(reloaded.status).toBe("CANCELLED");
  });
});
