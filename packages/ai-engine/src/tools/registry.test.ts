import { describe, expect, it } from "vitest";
import { buildToolRegistry, findTool, toToolSpecs } from "./registry.js";

describe("buildToolRegistry", () => {
  it("always includes get_current_time", () => {
    const tools = buildToolRegistry();
    expect(findTool(tools, "get_current_time")).toBeDefined();
    expect(findTool(tools, "search_web")).toBeUndefined();
  });

  it("includes search_web only when a Brave API key is configured", () => {
    const tools = buildToolRegistry({ braveSearchApiKey: "test-key" });
    expect(findTool(tools, "search_web")).toBeDefined();
  });

  it("converts to provider-facing specs without leaking handlers", () => {
    const tools = buildToolRegistry();
    const specs = toToolSpecs(tools);
    expect(specs[0]).toEqual({
      name: "get_current_time",
      description: tools[0].description,
      inputJsonSchema: tools[0].inputJsonSchema,
    });
    expect("handler" in specs[0]).toBe(false);
  });
});

describe("getCurrentTimeTool", () => {
  it("returns a valid ISO timestamp matching its own output schema", async () => {
    const tools = buildToolRegistry();
    const tool = findTool(tools, "get_current_time")!;
    const output = await tool.handler({}, { userId: "u1", taskId: "t1" });
    expect(tool.outputSchema.parse(output)).toEqual(output);
    expect(new Date(output.iso).getTime()).toBe(output.unixMs);
  });
});
