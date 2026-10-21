import pino from "pino";
import { redactObject } from "@jarvis/security";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  hooks: {
    logMethod(args, method) {
      const redactedArgs = args.map((arg) => (typeof arg === "object" && arg !== null ? redactObject(arg) : arg));
      return method.apply(this, redactedArgs as Parameters<typeof method>);
    },
  },
});
