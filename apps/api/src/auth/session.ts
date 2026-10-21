import type { Request, Response, NextFunction } from "express";
import { prisma } from "@jarvis/database";
import { createSessionToken, hashSessionToken } from "@jarvis/security";

export const SESSION_COOKIE_NAME = "jarvis_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(userId: string, meta: { userAgent?: string; ipHash?: string }) {
  const { token, tokenHash } = createSessionToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      userAgent: meta.userAgent,
      ipHash: meta.ipHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * Resolves the session cookie to a user on every request. Expiry is
 * re-checked against the database each time (not just the cookie's own
 * expiry) so revoking a session takes effect immediately — see
 * docs/security-model.md §3.
 */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || typeof token !== "string") {
    return next();
  }

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({ where: { tokenHash } });
  if (session && session.expiresAt > new Date()) {
    req.user = { id: session.userId };
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required." } });
    return;
  }
  next();
}
