import { google } from "googleapis";

// Least-privilege for what Phase 5/7 actually implement: read/search +
// draft creation + send (gated behind approval) for Gmail, read-only for
// Calendar and Drive — docs/architecture.md,
// docs/implementation-roadmap.md Phase 5 & 7.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createOAuth2Client(config: GoogleOAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

/**
 * access_type=offline + prompt=consent — required to reliably get a
 * refresh_token back, including on re-connect — verified against
 * Google's OAuth2 web-server-flow documentation.
 */
export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const client = createOAuth2Client(config);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

export interface GoogleTokens {
  refreshToken: string;
  email: string | undefined;
}

export async function exchangeGoogleCode(config: GoogleOAuthConfig, code: string): Promise<GoogleTokens> {
  const client = createOAuth2Client(config);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect any prior grant for this app in your Google Account and try connecting again.",
    );
  }
  client.setCredentials(tokens);

  const { token: accessToken } = await client.getAccessToken();
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await res.json().catch(() => ({}))) as { email?: string };

  return { refreshToken: tokens.refresh_token, email: profile.email };
}

/** An OAuth2Client pre-loaded with a stored refresh token — googleapis
 * transparently fetches/refreshes access tokens as needed per request. */
export function createAuthorizedClient(config: GoogleOAuthConfig, refreshToken: string) {
  const client = createOAuth2Client(config);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
