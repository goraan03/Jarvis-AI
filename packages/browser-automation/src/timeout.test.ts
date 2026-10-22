import { describe, expect, it, afterAll } from "vitest";
import { withGuardedContext, closeBrowser } from "./runner.js";

describe("withGuardedContext — hard timeout", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("rejects and force-closes the page when the operation never resolves", async () => {
    let capturedPage: import("playwright").Page | undefined;

    const promise = withGuardedContext(async (page) => {
      capturedPage = page;
      return new Promise(() => {
        // Deliberately never resolves — simulates a hung page/script.
      });
    }, 300);

    await expect(promise).rejects.toThrow(/exceeded its execution timeout/i);

    // Prove the page was actually torn down (process-level termination
    // of that job's browser activity), not just abandoned while the
    // promise sits forever — docs/implementation-roadmap.md Phase 8 gate.
    expect(capturedPage?.isClosed()).toBe(true);
  }, 10_000);

  it("does not time out when the operation finishes well within the limit", async () => {
    const result = await withGuardedContext(async () => "done", 5000);
    expect(result).toBe("done");
  });
});
