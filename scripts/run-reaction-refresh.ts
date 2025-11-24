import "dotenv/config";

import { refreshAttentionReactions } from "@/lib/sync/reaction-refresh";

async function main() {
  try {
    await refreshAttentionReactions({
      logger: (message) => {
        console.log(message);
      },
    });
    console.log("[script] Reaction refresh completed successfully.");
  } catch (error) {
    console.error("[script] Reaction refresh failed:", error);
    process.exitCode = 1;
  }
}

void main();
