import type { ToolDefinition } from "@jarvis/ai-engine";
import { isGoogleConnected } from "./credentials.js";
import { buildGoogleTools, type GoogleToolsConfig } from "./tools.js";

export { createOAuth2Client, buildGoogleAuthUrl, exchangeGoogleCode, createAuthorizedClient, GOOGLE_SCOPES } from "./oauth.js";
export type { GoogleOAuthConfig, GoogleTokens } from "./oauth.js";
export { saveGoogleCredential, getGoogleRefreshToken, isGoogleConnected, disconnectGoogle } from "./credentials.js";
export { createOAuthState, consumeOAuthState } from "./state.js";
export { getGmailClient, getCalendarClient, GoogleNotConnectedError } from "./clients.js";
export { buildGoogleTools } from "./tools.js";
export type { GoogleToolsConfig } from "./tools.js";

/**
 * Per-task dynamic tool resolver: only returns the Gmail/Calendar tools
 * when this specific user actually has a connected Google account —
 * passed as RunAgentTaskDeps.resolveDynamicTools.
 */
export function createGoogleToolsResolver(config: GoogleToolsConfig): (userId: string) => Promise<ToolDefinition<any, any>[]> {
  const tools = buildGoogleTools(config);
  return async (userId: string) => ((await isGoogleConnected(userId)) ? tools : []);
}
