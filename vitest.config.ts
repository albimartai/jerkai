import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirror tsconfig's "@/*" path alias for test imports.
const alias = { "@": path.resolve(import.meta.dirname) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["lib/**/*.test.ts", "tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Runs against a real, disposable Neon branch — DATABASE_URL must
        // point at one (CI creates it per run; see scripts/ci/neon-branch.mjs).
        // Kept out of `npm test` so unit tests never need a database.
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // All integration files share one database and truncate tables
          // between cases — parallel files would wipe each other mid-test.
          fileParallelism: false,
        },
      },
    ],
  },
});
