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
    include: [
      "**/*.db.test.ts",
      "**/analytics.issue-creation-closure.metrics.test.ts",
    ],
    exclude: configDefaults.exclude,
  },
});
