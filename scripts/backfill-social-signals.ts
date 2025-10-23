import { loadEnvConfig } from "@next/env";
import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { refreshActivitySocialSignals } from "@/lib/activity/social-signals";
import { closePool, ensureSchema } from "@/lib/db";

async function main() {
  const directSocialOnly = process.argv.includes("--signals-only");

  loadEnvConfig(process.cwd());
  console.info("[backfill] ensuring database schema");
  await ensureSchema();

  if (directSocialOnly) {
    await refreshActivitySocialSignals({ truncate: true });
  } else {
    await refreshActivityItemsSnapshot({ truncate: true });
  }

  console.info(
    `[backfill] completed ${
      directSocialOnly ? "social signal" : "snapshot + social signal"
    } refresh`,
  );

  await closePool();
}

main().catch((error) => {
  console.error("[backfill] failed", error);
  process.exit(1);
});
