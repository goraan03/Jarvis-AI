import { describe, expect, it } from "vitest";
import { createSessionToken, hashSessionToken } from "./session.js";

describe("createSessionToken", () => {
  it("produces a token whose hash matches hashSessionToken", () => {
    const { token, tokenHash } = createSessionToken();
    expect(hashSessionToken(token)).toBe(tokenHash);
  });

  it("produces different tokens each call", () => {
    const a = createSessionToken();
    const b = createSessionToken();
    expect(a.token).not.toBe(b.token);
  });
});
