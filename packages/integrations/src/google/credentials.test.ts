import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@jarvis/database";
import { saveGoogleCredential, getGoogleRefreshToken, isGoogleConnected, disconnectGoogle } from "./credentials.js";

const key = randomBytes(32).toString("base64");

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

describe("Google credential storage", () => {
  it("round-trips an encrypted refresh token and reports connected", async () => {
    const user = await makeUser();
    await saveGoogleCredential(user.id, "refresh-token-abc", "owner@gmail.com", key);

    expect(await isGoogleConnected(user.id)).toBe(true);
    expect(await getGoogleRefreshToken(user.id, key)).toBe("refresh-token-abc");

    const integration = await prisma.integration.findUnique({
      where: { userId_provider: { userId: user.id, provider: "google" } },
    });
    expect(integration?.externalId).toBe("owner@gmail.com");
  });

  it("never stores the refresh token in plaintext", async () => {
    const user = await makeUser();
    await saveGoogleCredential(user.id, "super-secret-refresh-token", "owner@gmail.com", key);

    const integration = await prisma.integration.findUniqueOrThrow({
      where: { userId_provider: { userId: user.id, provider: "google" } },
      include: { credential: true },
    });
    const raw = Buffer.from(integration.credential!.ciphertext).toString("utf8");
    expect(raw).not.toContain("super-secret-refresh-token");
  });

  it("disconnect removes the credential and flips status", async () => {
    const user = await makeUser();
    await saveGoogleCredential(user.id, "refresh-token-abc", "owner@gmail.com", key);

    const result = await disconnectGoogle(user.id);
    expect(result).toBe(true);
    expect(await isGoogleConnected(user.id)).toBe(false);
    expect(await getGoogleRefreshToken(user.id, key)).toBeNull();
  });

  it("returns false/null for a user who never connected", async () => {
    const user = await makeUser();
    expect(await isGoogleConnected(user.id)).toBe(false);
    expect(await getGoogleRefreshToken(user.id, key)).toBeNull();
  });
});
