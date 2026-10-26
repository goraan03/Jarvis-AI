import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";

function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { workspaces?: unknown };
        if (Array.isArray(pkg.workspaces)) return dir;
      } catch {
        // Malformed package.json above us somewhere unrelated — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find the monorepo root (no package.json with a "workspaces" field) above ${startDir}`);
    }
    dir = parent;
  }
}

// Side effect on import, by design — this module must be the FIRST import
// in any process entry point, before anything that reads process.env at
// ITS OWN top level (e.g. packages/database's PrismaClient construction).
// `npm run <script> -w <workspace>` runs with cwd set to that workspace's
// own directory, not the repo root, so a bare `dotenv.config()`/
// `import "dotenv/config"` silently finds nothing there and every env var
// is left undefined — resolved here via an absolute path from this file's
// own location instead, the same fix packages/database/prisma.config.ts
// already uses for the Prisma CLI.
const root = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, ".env") });
