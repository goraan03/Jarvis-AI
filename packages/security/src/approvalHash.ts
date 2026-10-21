import { createHash } from "node:crypto";

/**
 * Deterministic hash of a tool call's validated input, used to bind an
 * ApprovalRequest to exactly these parameters. Re-computed at execution
 * time and compared against the stored hash — a mismatch blocks
 * execution and requires a fresh approval, even if the request's status
 * is APPROVED — docs/security-model.md §5.
 */
export function hashApprovalInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
