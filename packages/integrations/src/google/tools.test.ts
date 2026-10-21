import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@jarvis/database";
import { buildGoogleTools } from "./tools.js";
import { createGoogleToolsResolver } from "./index.js";
import { saveGoogleCredential } from "./credentials.js";

const config = {
  oauth: { clientId: "x", clientSecret: "x", redirectUri: "http://localhost/callback" },
  encryptionMasterKey: Buffer.alloc(32, 1).toString("base64"),
};

async function makeUser() {
  const email = `${randomUUID()}@example.com`;
  return prisma.user.create({ data: { email, passwordHash: "x", settings: { create: {} } } });
}

describe("buildGoogleTools", () => {
  it("gates send_email behind approval and marks it high risk; everything else is unapproved/low-risk", () => {
    const tools = buildGoogleTools(config);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    expect(byName.send_email.requiresApproval).toBe(true);
    expect(byName.send_email.riskLevel).toBe("high");

    for (const name of ["search_emails", "read_email", "create_email_draft", "get_calendar_events"]) {
      expect(byName[name].requiresApproval).toBe(false);
      expect(byName[name].riskLevel).toBe("low");
    }
  });
});

describe("createGoogleToolsResolver", () => {
  it("returns no tools for a user who hasn't connected Google", async () => {
    const user = await makeUser();
    const resolve = createGoogleToolsResolver(config);
    expect(await resolve(user.id)).toEqual([]);
  });

  it("returns the Google tools once the user has connected", async () => {
    const user = await makeUser();
    await saveGoogleCredential(user.id, "refresh-token", "owner@gmail.com", config.encryptionMasterKey);
    const resolve = createGoogleToolsResolver(config);
    const tools = await resolve(user.id);
    expect(tools.map((t) => t.name)).toContain("send_email");
  });
});
