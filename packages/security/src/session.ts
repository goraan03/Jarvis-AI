import { randomBytes, createHash } from "node:crypto";

/**
 * Generates a random session token and its stored hash. The raw token is
 * set in the client's cookie; only the hash is persisted, mirroring
 * password-hashing practice so a database read alone can't impersonate a
 * session (docs/security-model.md §3).
 */
export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
