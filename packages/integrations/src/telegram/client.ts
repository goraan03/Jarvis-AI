import type { TelegramChat, TelegramClient, TelegramMessage, TelegramUpdate, TelegramUser } from "./types.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/**
 * Real Telegram Bot API client over plain fetch — no SDK dependency, per
 * docs/architecture.md §11. The bot token lives only in the URL path of
 * requests this module makes; it is never logged directly (the shared
 * secret-redaction pattern in packages/security also matches Telegram's
 * token shape as a backstop).
 */
export function createTelegramClient(botToken: string): TelegramClient {
  const base = `https://api.telegram.org/bot${botToken}`;

  async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(`${base}/${method}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json()) as TelegramApiResponse<T>;
    if (!body.ok || body.result === undefined) {
      throw new Error(`Telegram API ${method} failed: ${body.description ?? res.status}`);
    }
    return body.result;
  }

  return {
    async getMe(): Promise<TelegramUser> {
      return call<TelegramUser>("getMe");
    },

    async getUpdates({ offset, timeoutSeconds = 0 }): Promise<TelegramUpdate[]> {
      return call<TelegramUpdate[]>("getUpdates", { offset, timeout: timeoutSeconds });
    },

    async sendMessage({ chatId, text, inlineKeyboard }): Promise<void> {
      await call<TelegramMessage>("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined,
      });
    },

    async answerCallbackQuery({ callbackQueryId, text, showAlert }): Promise<void> {
      await call<true>("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: showAlert });
    },
  };
}

export type { TelegramClient, TelegramUpdate, TelegramMessage, TelegramChat, TelegramUser };
