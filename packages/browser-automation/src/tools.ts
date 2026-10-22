import { z } from "zod";
import type { Queue, QueueEvents } from "bullmq";
import type { ToolDefinition } from "@jarvis/ai-engine";
import { enqueueBrowserJob } from "./queue.js";
import type { BrowserJobData, BrowsePageResult, DownloadFileResult, FillFormResult } from "./types.js";

export interface BrowserToolsDeps {
  queue: Pick<Queue<BrowserJobData>, "add">;
  queueEvents: QueueEvents;
}

const browsePageInput = z.object({ url: z.string().url() });
const browsePageOutput = z.object({ finalUrl: z.string(), title: z.string(), text: z.string(), actions: z.array(z.string()) });

const fillFormInput = z.object({
  url: z.string().url(),
  fields: z.array(z.object({ selector: z.string().min(1), value: z.string() })).min(1),
  submitSelector: z.string().min(1).optional(),
});
const fillFormOutput = z.object({ finalUrl: z.string(), title: z.string(), actions: z.array(z.string()) });

const downloadFileInput = z.object({ url: z.string().url() });
const downloadFileOutput = z.object({ filename: z.string(), sizeBytes: z.number(), contentType: z.string(), path: z.string() });

/**
 * These handlers never touch Playwright directly — they enqueue to the
 * browser-tasks queue and await the result, so the actual browser
 * execution always runs in the fully separate apps/browser-worker
 * process ("browser actions run outside the main API process" and,
 * more strongly here, outside the agent worker process too) —
 * docs/implementation-roadmap.md Phase 8.
 */
export function buildBrowserTools(deps: BrowserToolsDeps): ToolDefinition<any, any>[] {
  return [
    {
      name: "browse_page",
      description:
        "Navigates to a URL in an isolated sandboxed browser and extracts its visible text. Internal/private network addresses are always blocked.",
      inputSchema: browsePageInput,
      outputSchema: browsePageOutput,
      inputJsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 40_000,
      async handler(input) {
        return enqueueBrowserJob<BrowsePageResult>(deps.queue, deps.queueEvents, "browse_page", { url: input.url });
      },
    },
    {
      name: "fill_form",
      description:
        "Fills (and optionally submits) a web form in an isolated sandboxed browser. Always requires approval — this can trigger irreversible actions on the target site.",
      inputSchema: fillFormInput,
      outputSchema: fillFormOutput,
      inputJsonSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          fields: {
            type: "array",
            items: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } } },
          },
          submitSelector: { type: "string" },
        },
        required: ["url", "fields"],
      },
      riskLevel: "high",
      requiresApproval: true,
      timeoutMs: 40_000,
      async handler(input) {
        return enqueueBrowserJob<FillFormResult>(deps.queue, deps.queueEvents, "fill_form", input);
      },
    },
    {
      name: "download_file",
      description:
        "Downloads a file (text, PDF, JSON, or image, up to 10MB) from a URL to a scoped temp location. Internal/private network addresses are always blocked.",
      inputSchema: downloadFileInput,
      outputSchema: downloadFileOutput,
      inputJsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 40_000,
      async handler(input, ctx) {
        return enqueueBrowserJob<DownloadFileResult>(deps.queue, deps.queueEvents, "download_file", {
          url: input.url,
          taskId: ctx.taskId,
        });
      },
    },
  ];
}
