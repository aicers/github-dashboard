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
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/*.db.test.ts",
      "**/analytics.issue-creation-closure.metrics.test.ts",
      "tests/e2e/**",
    ],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
