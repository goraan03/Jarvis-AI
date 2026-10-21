export { createTelegramClient } from "./client.js";
export type { TelegramClient, TelegramUpdate, TelegramMessage, TelegramChat, TelegramUser } from "./types.js";
export { createLinkCode, consumeLinkCode, findUserByTelegramChatId } from "./linking.js";
export type { LinkCode, LinkResult } from "./linking.js";
export { processUpdate, shortId } from "./handler.js";
export type { TelegramHandlerDeps } from "./handler.js";
export { startTelegramPolling } from "./polling.js";
export type { PollingHandle } from "./polling.js";
export { notifyTaskResult } from "./notify.js";
