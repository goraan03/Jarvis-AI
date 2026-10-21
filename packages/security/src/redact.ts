const SECRET_KEY_PATTERN = /(sk-ant-[a-zA-Z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|[0-9]{8,10}:[A-Za-z0-9_-]{30,})/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]{10,}/gi;

/**
 * Scrubs known secret shapes (Anthropic/Google/Telegram/Slack-style keys,
 * bearer tokens) from arbitrary strings before they reach logs or audit
 * metadata. This is a defense-in-depth backstop, not the only control —
 * call sites should still avoid logging raw secrets.
 */
export function redactSecrets(input: string): string {
  return input.replace(SECRET_KEY_PATTERN, "[REDACTED]").replace(BEARER_PATTERN, "Bearer [REDACTED]");
}

const SENSITIVE_KEY_NAMES = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "authorization",
  "cookie",
]);

/**
 * Deep-redacts object values whose key name looks sensitive, and applies
 * redactSecrets to remaining string values. Used by the pino logger
 * transport so individual call sites can't forget to redact.
 */
export function redactObject<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_NAMES.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(val);
      }
    }
    return result as unknown as T;
  }
  return value;
}
