import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@jarvis/database";
import { proposeMemoryTool, resolveMemoryTools } from "./proposeMemory.js";

async function makeUser(autoMemoryEnabled = true) {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: { autoMemoryEnabled } } } });
}

describe("proposeMemoryTool", () => {
  it("creates a PROPOSED memory, never auto-approved", async () => {
    const user = await makeUser();
    const result = await proposeMemoryTool.handler(
      { category: "preference", content: "Likes concise answers", confidence: 0.8 },
      { userId: user.id, taskId: "t1" },
    );
    expect(result.status).toBe("proposed");
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: result.memoryId } });
    expect(memory.status).toBe("PROPOSED");
    expect(memory.source).toBe("task");
  });
});

describe("resolveMemoryTools", () => {
  it("offers propose_memory when autoMemoryEnabled is true", async () => {
    const user = await makeUser(true);
    const tools = await resolveMemoryTools(user.id);
    expect(tools.map((t) => t.name)).toContain("propose_memory");
  });

  it("offers nothing when autoMemoryEnabled is false", async () => {
    const user = await makeUser(false);
    const tools = await resolveMemoryTools(user.id);
    expect(tools).toEqual([]);
  });
});
