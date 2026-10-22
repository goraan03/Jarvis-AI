import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

/**
 * Express 5 forwards rejected promises from async route handlers here
 * automatically. Without this, an unhandled route error would fall
 * through to Express's default HTML error page — which, in a
 * non-production NODE_ENV, includes the stack trace. Every error still
 * gets logged with full detail server-side; the client only ever sees a
 * generic message.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err, path: req.path, method: req.method }, "unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
}
