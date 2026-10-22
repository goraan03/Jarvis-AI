import { google, type gmail_v1, type calendar_v3, type drive_v3 } from "googleapis";
import { getGoogleRefreshToken } from "./credentials.js";
import { createAuthorizedClient, type GoogleOAuthConfig } from "./oauth.js";

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google account is not connected. Connect it from the Integrations page first.");
    this.name = "GoogleNotConnectedError";
  }
}

async function getAuthorizedClient(userId: string, config: GoogleOAuthConfig, encryptionMasterKey: string) {
  const refreshToken = await getGoogleRefreshToken(userId, encryptionMasterKey);
  if (!refreshToken) {
    throw new GoogleNotConnectedError();
  }
  return createAuthorizedClient(config, refreshToken);
}

export async function getGmailClient(
  userId: string,
  config: GoogleOAuthConfig,
  encryptionMasterKey: string,
): Promise<gmail_v1.Gmail> {
  const auth = await getAuthorizedClient(userId, config, encryptionMasterKey);
  return google.gmail({ version: "v1", auth });
}

export async function getCalendarClient(
  userId: string,
  config: GoogleOAuthConfig,
  encryptionMasterKey: string,
): Promise<calendar_v3.Calendar> {
  const auth = await getAuthorizedClient(userId, config, encryptionMasterKey);
  return google.calendar({ version: "v3", auth });
}

export async function getDriveClient(
  userId: string,
  config: GoogleOAuthConfig,
  encryptionMasterKey: string,
): Promise<drive_v3.Drive> {
  const auth = await getAuthorizedClient(userId, config, encryptionMasterKey);
  return google.drive({ version: "v3", auth });
}
