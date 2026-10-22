import { env } from "./env.js";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

// Fail loud and exit rather than keep serving on corrupted state — a
// process manager (Docker restart policy, systemd, etc.) is the actual
// uptime mechanism here; this just guarantees we never silently limp
// along after something the error middleware couldn't catch (e.g. a sync
// throw during startup, or a rejection outside any request).
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection — exiting");
  process.exit(1);
});

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "jarvis api listening");
});
