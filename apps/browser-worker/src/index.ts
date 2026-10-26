import "@jarvis/shared/src/loadRootEnv.js";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv } from "@jarvis/shared";
import { createBrowserTaskWorker, runBrowsePage, runFillForm, runDownloadFile, closeBrowser } from "@jarvis/browser-automation";
import type { BrowsePageJobData, DownloadFileJobData, FillFormJobData } from "@jarvis/browser-automation";

const env = loadEnv();
const logger = pino({ transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined });

/**
 * A fully separate OS process from apps/api and apps/worker — the only
 * process that ever launches Playwright/Chromium or makes an
 * agent-initiated outbound HTTP request to an arbitrary URL. If this
 * process is compromised by malicious page content, it still can't
 * reach the main database/Redis credentials any more than this code
 * already allows, and its network egress is independently restricted
 * by the SSRF guard on every single request, not just the initial
 * navigation — docs/security-model.md §7, docs/architecture.md.
 */
async function main() {
  const probe = new Redis(env.REDIS_URL, { connectTimeout: 2000, retryStrategy: () => null });
  await probe.ping();
  await probe.quit();

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = createBrowserTaskWorker(connection, async (job) => {
    logger.info({ jobName: job.name, jobId: job.id }, "browser job starting");
    switch (job.name) {
      case "browse_page":
        return runBrowsePage(job.data as BrowsePageJobData);
      case "fill_form":
        return runFillForm(job.data as FillFormJobData);
      case "download_file":
        return runDownloadFile(job.data as DownloadFileJobData, (job.data as DownloadFileJobData).taskId);
      default:
        throw new Error(`Unknown browser job name "${job.name}".`);
    }
  });

  worker.on("completed", (job) => {
    logger.info({ jobName: job.name, jobId: job.id }, "browser job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobName: job?.name, jobId: job?.id, err }, "browser job failed");
  });

  logger.info("jarvis browser-worker listening on browser-tasks (isolated process, Playwright sandboxed)");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      logger.info({ signal }, "shutting down browser-worker");
      await worker.close();
      await closeBrowser();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  logger.error({ err: error }, "browser-worker failed to start");
  process.exitCode = 1;
});
