import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jarvis/database";
import { verifyPassword, hashIp, hashSessionToken, writeAuditLog } from "@jarvis/security";
import { createSession, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from "../auth/session.js";
import { logger } from "../logger.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid email or password format." } });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : false;

  if (!user || !valid) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." } });
    return;
  }

  const ip = req.ip ?? "unknown";
  const { token } = await createSession(user.id, {
    userAgent: req.header("user-agent"),
    ipHash: hashIp(ip),
  });
  setSessionCookie(res, token);

  logger.info({ userId: user.id }, "login succeeded");
  await writeAuditLog({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    if (session) {
      await writeAuditLog({ userId: session.userId, action: "auth.logout", entityType: "User", entityId: session.userId });
    }
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required." } });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required." } });
    return;
  }
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});
