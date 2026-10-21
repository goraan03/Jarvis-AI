import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query: z.string().min(1).max(500),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    }),
  ),
});

interface BraveSearchResponse {
  web?: {
    results?: Array<{ title: string; url: string; description: string }>;
  };
}

/**
 * Real Brave Search API call — https://api.search.brave.com/res/v1/web/search.
 * Only registered by buildToolRegistry when BRAVE_SEARCH_API_KEY is
 * configured; the model never sees this tool otherwise
 * (docs/implementation-roadmap.md Phase 3).
 */
export function createSearchWebTool(apiKey: string): ToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> {
  return {
    name: "search_web",
    description: "Searches the public web and returns a short list of results (title, url, snippet).",
    inputSchema,
    outputSchema,
    inputJsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query." } },
      required: ["query"],
      additionalProperties: false,
    },
    riskLevel: "low",
    requiresApproval: false,
    timeoutMs: 10_000,
    async handler(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", input.query);
        url.searchParams.set("count", "5");

        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Brave Search API responded with ${res.status}`);
        }

        const body = (await res.json()) as BraveSearchResponse;
        const results = (body.web?.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));
        return { results };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
