import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loaded here, before any test file's own `dotenv/config` import runs, so
// DATABASE_URL etc. are already set by the time app code's dotenv call
// happens — dotenv never overrides an already-set variable. This points
// tests at a separate jarvis_test database, never the dev database
// (docs/testing.md).
dotenv.config({ path: path.resolve(__dirname, ".env.test") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/web/**"],
    fileParallelism: false,
  },
});
