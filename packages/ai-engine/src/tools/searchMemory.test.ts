import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@jarvis/database";
import { searchMemoryTool } from "./searchMemory.js";

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

describe("searchMemoryTool", () => {
  it("finds an approved memory matching the query", async () => {
    const user = await makeUser();
    await prisma.memory.create({
      data: { userId: user.id, category: "preference", content: "Prefers dark mode interfaces", source: "manual", status: "APPROVED" },
    });

    const result = await searchMemoryTool.handler({ query: "dark mode", limit: 5 }, { userId: user.id, taskId: "t1" });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].content).toContain("dark mode");
  });

  it("never returns a PROPOSED memory, even if it matches", async () => {
    const user = await makeUser();
    await prisma.memory.create({
      data: { userId: user.id, category: "fact", content: "Lives in Berlin", source: "task", status: "PROPOSED" },
    });

    const result = await searchMemoryTool.handler({ query: "Berlin", limit: 5 }, { userId: user.id, taskId: "t1" });
    expect(result.memories).toHaveLength(0);
  });

  it("never returns another user's memory", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await prisma.memory.create({
      data: { userId: userA.id, category: "fact", content: "Owns a 2019 Honda Civic", source: "manual", status: "APPROVED" },
    });

    const result = await searchMemoryTool.handler({ query: "Honda Civic", limit: 5 }, { userId: userB.id, taskId: "t1" });
    expect(result.memories).toHaveLength(0);
  });
});
