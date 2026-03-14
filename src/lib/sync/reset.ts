import { ensureSchema } from "@/lib/db";
import {
  cleanupRunningSyncRuns,
  resetData as resetDatabase,
  updateSyncConfig,
} from "@/lib/db/operations";
import { emitSyncEvent } from "@/lib/sync/event-bus";
import { coerceIso } from "@/lib/sync/internal";

export async function resetData({
  preserveLogs = true,
}: {
  preserveLogs?: boolean;
}) {
  await ensureSchema();
  await resetDatabase({ preserveLogs });
  await updateSyncConfig({
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSuccessfulSyncAt: null,
  });
}

export async function cleanupStuckSyncRuns(options?: { actorId?: string }) {
  await ensureSchema();
  const result = await cleanupRunningSyncRuns();
  const runCount = result.runs.length;
  const logCount = result.logs.length;
  const nowIso = new Date().toISOString();

  console.log(
    `[github-dashboard] Cleanup of running syncs requested by ${
      options?.actorId ?? "unknown"
    } (runs=${runCount}, logs=${logCount})`,
  );

  for (const run of result.runs) {
    const completedAt = coerceIso(run.completed_at) ?? nowIso;
    emitSyncEvent({
      type: "run-status",
      runId: Number(run.id),
      status: "failed",
      completedAt,
    });
    emitSyncEvent({
      type: "run-failed",
      runId: Number(run.id),
      status: "failed",
      finishedAt: completedAt,
      error: "Marked as failed by admin cleanup.",
    });
  }

  for (const log of result.logs) {
    const runId = Number(log.run_id);
    if (!Number.isFinite(runId)) {
      continue;
    }
    emitSyncEvent({
      type: "log-updated",
      logId: log.id,
      runId,
      resource: log.resource,
      status: "failed",
      message: log.message ?? null,
      finishedAt: coerceIso(log.finished_at) ?? nowIso,
    });
  }

  return { runCount, logCount };
}
