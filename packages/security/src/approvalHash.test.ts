import { describe, expect, it } from "vitest";
import { hashApprovalInput } from "./approvalHash.js";

describe("hashApprovalInput", () => {
  it("is deterministic for identical input", () => {
    const input = { to: "a@example.com", subject: "hi", body: "hello" };
    expect(hashApprovalInput(input)).toBe(hashApprovalInput({ ...input }));
  });

  it("changes when any field changes", () => {
    const a = hashApprovalInput({ to: "a@example.com", subject: "hi", body: "hello" });
    const b = hashApprovalInput({ to: "a@example.com", subject: "hi", body: "hello!!" });
    expect(a).not.toBe(b);
  });
});
