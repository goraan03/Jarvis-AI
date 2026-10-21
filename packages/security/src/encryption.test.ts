import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptCredential, decryptCredential } from "./encryption.js";

const key = randomBytes(32).toString("base64");

describe("encryptCredential / decryptCredential", () => {
  it("round-trips plaintext", () => {
    const payload = encryptCredential("my-refresh-token", key);
    expect(decryptCredential(payload, key)).toBe("my-refresh-token");
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encryptCredential("same-input", key);
    const b = encryptCredential("same-input", key);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails to decrypt with the wrong key", () => {
    const payload = encryptCredential("secret", key);
    const wrongKey = randomBytes(32).toString("base64");
    expect(() => decryptCredential(payload, wrongKey)).toThrow();
  });

  it("fails to decrypt if the ciphertext was tampered with", () => {
    const payload = encryptCredential("secret", key);
    payload.ciphertext[0] ^= 0xff;
    expect(() => decryptCredential(payload, key)).toThrow();
  });

  it("rejects a master key that isn't 32 bytes", () => {
    expect(() => encryptCredential("x", Buffer.from("too-short").toString("base64"))).toThrow(/32 bytes/);
  });
});
