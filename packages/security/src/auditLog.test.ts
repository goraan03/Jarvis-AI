import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@jarvis/database";
import { writeAuditLog } from "./auditLog.js";

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

describe("writeAuditLog", () => {
  it("persists an entry with the given action/entity/metadata", async () => {
    const user = await makeUser();
    await writeAuditLog({
      userId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      metadata: { ip: "127.0.0.1" },
    });

    const rows = await prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("auth.login");
    expect(rows[0].entityType).toBe("User");
    expect(rows[0].metadata).toEqual({ ip: "127.0.0.1" });
  });

  it("redacts sensitive metadata fields before persisting", async () => {
    const user = await makeUser();
    await writeAuditLog({
      userId: user.id,
      action: "integration.connect",
      metadata: { provider: "google", accessToken: "sk-ant-abcdefghijklmnopqrstuvwxyz" },
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: user.id } });
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.provider).toBe("google");
    expect(metadata.accessToken).toBe("[REDACTED]");
  });

  it("stores no metadata column value when none is given", async () => {
    const user = await makeUser();
    await writeAuditLog({ userId: user.id, action: "auth.logout" });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.metadata).toBeNull();
  });
});
