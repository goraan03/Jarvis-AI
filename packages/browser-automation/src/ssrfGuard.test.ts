import { describe, expect, it } from "vitest";
import { checkUrlAllowed } from "./ssrfGuard.js";

describe("checkUrlAllowed", () => {
  it("blocks a literal IP in the cloud metadata range", async () => {
    const result = await checkUrlAllowed("http://169.254.169.254/latest/meta-data/");
    expect(result.blocked).toBe(true);
  });

  it("blocks a literal RFC1918 private IP", async () => {
    const result = await checkUrlAllowed("http://10.0.0.5/");
    expect(result.blocked).toBe(true);
  });

  it("blocks localhost by name", async () => {
    const result = await checkUrlAllowed("http://localhost:8080/");
    expect(result.blocked).toBe(true);
  });

  it("blocks a bracketed literal IPv6 loopback", async () => {
    const result = await checkUrlAllowed("http://[::1]/");
    expect(result.blocked).toBe(true);
  });

  it("blocks non-http(s) schemes", async () => {
    expect((await checkUrlAllowed("file:///etc/passwd")).blocked).toBe(true);
    expect((await checkUrlAllowed("ftp://example.com/")).blocked).toBe(true);
  });

  it("blocks a malformed URL", async () => {
    expect((await checkUrlAllowed("not a url")).blocked).toBe(true);
  });

  it("blocks a hostname that fails to resolve", async () => {
    const result = await checkUrlAllowed("http://this-host-definitely-does-not-exist.invalid/");
    expect(result.blocked).toBe(true);
  });

  it("allows a normal public https URL", async () => {
    const result = await checkUrlAllowed("https://example.com/");
    expect(result.blocked).toBe(false);
  });
});
