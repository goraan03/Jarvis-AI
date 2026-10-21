import { env } from "./env.js";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "jarvis api listening");
});
