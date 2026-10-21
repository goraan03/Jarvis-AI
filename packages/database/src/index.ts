import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __jarvisPrisma: PrismaClient | undefined;
}

// Falls back to an unreachable placeholder rather than throwing at import
// time when DATABASE_URL is unset (e.g. unit tests that never hit the DB) —
// callers see a real connection error from an actual query instead.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "postgresql://invalid:invalid@localhost:5432/invalid",
});

/**
 * Single shared PrismaClient per process. Reused across hot reloads in dev
 * via a global so we don't exhaust Postgres connections.
 */
export const prisma: PrismaClient = globalThis.__jarvisPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalThis.__jarvisPrisma = prisma;
}

export * from "@prisma/client";
