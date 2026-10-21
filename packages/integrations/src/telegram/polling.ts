import type { TelegramClient } from "./types.js";
import { processUpdate, type TelegramHandlerDeps } from "./handler.js";

export interface PollingHandle {
  stop(): void;
}

/**
 * Long-polling loop for local development, where there's no public HTTPS
 * endpoint for a webhook (docs/risk-register.md #5). Shares processUpdate
 * with the webhook route, so switching transports later needs no logic
 * change — only the deployment config differs.
 */
export function startTelegramPolling(
  client: TelegramClient,
  deps: TelegramHandlerDeps,
  onError: (error: unknown) => void,
): PollingHandle {
  let stopped = false;
  let offset: number | undefined;

  async function loop() {
    while (!stopped) {
      try {
        const updates = await client.getUpdates({ offset, timeoutSeconds: 25 });
        for (const update of updates) {
          offset = update.update_id + 1;
          await processUpdate(update, deps);
        }
      } catch (error) {
        onError(error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  void loop();

  return {
    stop() {
      stopped = true;
    },
  };
}
