import type { ToolSpec } from "../types.js";
import type { ToolDefinition } from "./types.js";
import { getCurrentTimeTool } from "./getCurrentTime.js";
import { createSearchWebTool } from "./searchWeb.js";

export interface ToolRegistryConfig {
  braveSearchApiKey?: string;
}

/**
 * Only includes tools that are actually implemented AND configured.
 * search_web is omitted entirely (not just "disabled") when no API key is
 * set, so the model never sees a tool it can't really call —
 * docs/implementation-roadmap.md Phase 3.
 */
export function buildToolRegistry(config: ToolRegistryConfig = {}): ToolDefinition<any, any>[] {
  const tools: ToolDefinition<any, any>[] = [getCurrentTimeTool];
  if (config.braveSearchApiKey) {
    tools.push(createSearchWebTool(config.braveSearchApiKey));
  }
  return tools;
}

export function toToolSpecs(tools: ToolDefinition<any, any>[]): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputJsonSchema: tool.inputJsonSchema,
  }));
}

export function findTool(tools: ToolDefinition<any, any>[], name: string): ToolDefinition<any, any> | undefined {
  return tools.find((tool) => tool.name === name);
}
