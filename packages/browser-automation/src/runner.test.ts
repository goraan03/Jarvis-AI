import { describe, expect, it, afterAll } from "vitest";
import { runBrowsePage, closeBrowser } from "./runner.js";

// These tests launch a real (headless) Chromium — the whole point of
// Phase 8 is that SSRF blocking holds for real page navigation, not
// just at the pure-function level already covered by ssrfGuard.test.ts.
describe("runBrowsePage", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("blocks navigation to the cloud metadata endpoint before any request is made", async () => {
    await expect(runBrowsePage({ url: "http://169.254.169.254/latest/meta-data/" })).rejects.toThrow(/blocked/i);
  });

  it("blocks navigation to a private RFC1918 address", async () => {
    await expect(runBrowsePage({ url: "http://10.0.0.1/" })).rejects.toThrow(/blocked/i);
  });

  it("navigates a real public page and extracts its text", async () => {
    const result = await runBrowsePage({ url: "https://example.com/" });
    expect(result.title.toLowerCase()).toContain("example");
    expect(result.text.length).toBeGreaterThan(20);
    expect(result.finalUrl).toContain("example.com");
    expect(result.actions.some((a) => a.startsWith("navigate"))).toBe(true);
  }, 20_000);
});
