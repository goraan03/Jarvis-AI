import { prisma, type Prisma } from "@jarvis/database";
import { redactObject } from "./redact.js";

export interface AuditLogEntry {
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The single write path for AuditLog rows — metadata always goes through
 * redactObject() here so no call site can forget to scrub secrets before
 * they land in a permanent, read-only trail (docs/security-model.md §10).
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ? (redactObject(entry.metadata) as Prisma.InputJsonValue) : undefined,
    },
  });
}
