import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookies are sameSite=lax, which blocks most cross-site state-changing
 * requests, but lax still allows some top-level navigations to carry
 * cookies. Belt-and-suspenders: every mutating request must also carry a
 * custom header that a cross-origin HTML form (the classic CSRF vector)
 * cannot set. docs/security-model.md §3.
 */
export function csrfHeaderCheck(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  if (req.header("x-jarvis-client") !== "web") {
    res.status(403).json({ error: { code: "CSRF_CHECK_FAILED", message: "Missing required client header." } });
    return;
  }
  next();
}
