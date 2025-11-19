import { refreshActivityCaches } from "@/lib/activity/cache";
import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { ensureSchema } from "@/lib/db";
import { reimportActivityNode, type SyncLogger } from "@/lib/github/collectors";

export type ActivityItemResyncSummary = {
  nodeId: string;
  type: "issue" | "pull_request" | "discussion";
};

type ActivityItemResyncOptions = {
  logger?: SyncLogger;
};

export async function resyncActivityItem(
  nodeId: string,
  options?: ActivityItemResyncOptions,
): Promise<ActivityItemResyncSummary> {
  const trimmed = nodeId.trim();
  if (!trimmed.length) {
    throw new Error("Activity id is required.");
  }

  await ensureSchema();
  const logger =
    options?.logger ??
    ((message: string) => {
      console.info("[activity-resync]", message);
    });

  logger(`Starting manual re-import for ${trimmed}`);
  try {
    const summary = await reimportActivityNode({
      nodeId: trimmed,
      logger,
    });

    await refreshActivityItemsSnapshot({ ids: [trimmed] });
    await refreshActivityCaches({ reason: "manual-item-resync" });

    logger(`Completed manual re-import for ${trimmed}`);
    return summary;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    console.error(
      "[activity-resync] Failed manual re-import",
      trimmed,
      message,
    );
    throw error;
  }
}
