import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxDev: true,
  },
  test: {
    globals: true,
    environment: "node",
    // DB integration tests share a single Postgres instance and reset tables.
    // Run files serially to avoid TRUNCATE lock-order deadlocks in CI.
    fileParallelism: false,
    include: [
      "**/*.db.test.ts",
      "**/analytics.issue-creation-closure.metrics.test.ts",
    ],
    exclude: configDefaults.exclude,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
