import { loadEnvConfig } from "@next/env";

let initialized = false;

export function ensureRuntimeEnv() {
  if (initialized) {
    return;
  }
  const { loadedEnvFiles } = loadEnvConfig(process.cwd(), true);
  if (!loadedEnvFiles?.length) {
    console.warn(
      "[env] No .env files were loaded. Ensure DATABASE_URL and GITHUB_TOKEN are set.",
    );
  }
  initialized = true;
}

ensureRuntimeEnv();
