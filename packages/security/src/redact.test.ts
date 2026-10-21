import { describe, expect, it } from "vitest";
import { redactObject, redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("redacts an Anthropic-shaped API key embedded in text", () => {
    const text = "using key sk-ant-abcdefghijklmnopqrstuvwxyz for the call";
    expect(redactSecrets(text)).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz");
    expect(redactSecrets(text)).toContain("[REDACTED]");
  });

  it("redacts a bearer token", () => {
    const text = "Authorization: Bearer abcdefghijklmnop123456";
    expect(redactSecrets(text)).toBe("Authorization: Bearer [REDACTED]");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("hello world")).toBe("hello world");
  });
});

describe("redactObject", () => {
  it("redacts values under sensitive key names, recursively", () => {
    const input = {
      email: "owner@example.com",
      password: "super-secret",
      nested: { apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz" },
    };
    const result = redactObject(input) as typeof input;
    expect(result.email).toBe("owner@example.com");
    expect(result.password).toBe("[REDACTED]");
    expect(result.nested.apiKey).toBe("[REDACTED]");
  });
});
