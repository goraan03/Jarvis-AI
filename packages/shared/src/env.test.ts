import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("parses a valid environment", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://localhost/test",
      REDIS_URL: "redis://localhost:6379",
    });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(4000);
    expect(env.AI_PROVIDER).toBe("mock");
  });

  it("throws a readable error when required vars are missing", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it("coerces PORT to a number", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://localhost/test",
      REDIS_URL: "redis://localhost:6379",
      PORT: "5000",
    });
    expect(env.PORT).toBe(5000);
  });
});
