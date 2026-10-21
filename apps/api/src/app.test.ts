import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("GET /api/v1/health", () => {
  it("returns ok without requiring auth or DB/Redis", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /api/v1/health/ready", () => {
  it("reports per-dependency status", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/health/ready");
    expect(res.body.checks).toHaveProperty("database");
    expect(res.body.checks).toHaveProperty("redis");
    expect([200, 503]).toContain(res.status);
  });
});
