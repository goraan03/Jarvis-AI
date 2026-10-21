import { randomBytes } from "node:crypto";
import { prisma } from "@jarvis/database";

const STATE_TTL_MS = 10 * 60 * 1000;

/** CSRF state for the OAuth redirect round-trip — single-use, short TTL. */
export async function createOAuthState(userId: string, provider: string): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await prisma.oAuthState.create({ data: { state, userId, provider, expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
  return state;
}

export async function consumeOAuthState(state: string, provider: string): Promise<string | null> {
  const record = await prisma.oAuthState.findUnique({ where: { state } });
  if (record) {
    await prisma.oAuthState.delete({ where: { state } });
  }
  if (!record || record.provider !== provider || record.expiresAt < new Date()) {
    return null;
  }
  return record.userId;
}
