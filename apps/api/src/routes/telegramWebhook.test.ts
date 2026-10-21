import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { TelegramClient } from "@jarvis/integrations";
import { createApp } from "../app.js";

function fakeTelegramClient(): TelegramClient {
  return {
    getMe: vi.fn(async () => ({ id: 1, is_bot: true, first_name: "Jarvis" })),
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(async () => {}),
    answerCallbackQuery: vi.fn(async () => {}),
  };
}

describe("POST /webhooks/telegram", () => {
  it("is not mounted at all when no Telegram client is configured", async () => {
    const app = createApp({ taskQueue: { add: async () => ({}) } as any });
    const res = await request(app).post("/webhooks/telegram").send({ update_id: 1 });
    expect(res.status).toBe(404);
  });

  it("rejects requests without the correct secret token", async () => {
    const app = createApp({
      taskQueue: { add: async () => ({}) } as any,
      telegramClient: fakeTelegramClient(),
      telegramWebhookSecret: "correct-secret",
    });
    const res = await request(app).post("/webhooks/telegram").send({ update_id: 1 });
    expect(res.status).toBe(401);
  });

  it("rejects everything when no secret is configured (fails closed)", async () => {
    const app = createApp({
      taskQueue: { add: async () => ({}) } as any,
      telegramClient: fakeTelegramClient(),
      telegramWebhookSecret: undefined,
    });
    const res = await request(app)
      .post("/webhooks/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", "anything")
      .send({ update_id: 1 });
    expect(res.status).toBe(401);
  });

  it("accepts and processes an update with the correct secret token", async () => {
    const client = fakeTelegramClient();
    const app = createApp({
      taskQueue: { add: async () => ({}) } as any,
      telegramClient: client,
      telegramWebhookSecret: "correct-secret",
    });
    const res = await request(app)
      .post("/webhooks/telegram")
      .set("X-Telegram-Bot-Api-Secret-Token", "correct-secret")
      .send({
        update_id: Math.floor(Math.random() * 1_000_000_000),
        message: {
          message_id: 1,
          chat: { id: 999, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "hello",
        },
      });
    expect(res.status).toBe(200);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
});
