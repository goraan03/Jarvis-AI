export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramClient {
  getMe(): Promise<TelegramUser>;
  getUpdates(params: { offset?: number; timeoutSeconds?: number }): Promise<TelegramUpdate[]>;
  sendMessage(params: { chatId: number | string; text: string; inlineKeyboard?: InlineKeyboardButton[][] }): Promise<void>;
  answerCallbackQuery(params: { callbackQueryId: string; text?: string; showAlert?: boolean }): Promise<void>;
}
