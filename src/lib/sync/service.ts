import { z } from "zod";

import { refreshActivityCaches } from "@/lib/activity/cache";
import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { ensureIssueStatusAutomation } from "@/lib/activity/status-automation";
import { runUnansweredMentionClassification } from "@/lib/dashboard/unanswered-mention-classifier";
import { ensureSchema } from "@/lib/db";
import {
  createSyncRun,
  getSyncConfig,
  getSyncState,
  recordSyncLog,
  type SyncRunType,
  updateSyncConfig,
  updateSyncLog,
  updateSyncRunStatus,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import type { ResourceKey, SyncLogger } from "@/lib/github/collectors";
import {
  collectPullRequestLinks,
  RESOURCE_KEYS,
  runCollection,
} from "@/lib/github/collectors";
import { withJobLock } from "@/lib/jobs/lock";
import { emitSyncEvent } from "@/lib/sync/event-bus";
import type { SyncRunSummaryEvent } from "@/lib/sync/events";
import { coerceIso } from "@/lib/sync/internal";
import { refreshAttentionReactions } from "@/lib/sync/reaction-refresh";
import {
  getSchedulerState,
  initializeScheduler,
  registerSyncRunner,
  scheduleNextSyncRun,
  startScheduler,
  stopScheduler,
} from "@/lib/sync/scheduler";

const dateSchema = z.string().transform((value, ctx) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid date value.",
    });
    return z.NEVER;
  }

  return date.toISOString();
});

type SyncRunResult = {
  since: string | null;
  until: string | null;
  startedAt: string;
  completedAt: string;
  summary: Awaited<ReturnType<typeof runCollection>>;
};

type SyncCounts = SyncRunResult["summary"]["counts"];

async function logSyncStep(params: {
  runId: number;
  resource: string;
  message: string;
  step: () => Promise<void>;
  logger?: SyncLogger;
}) {
  const { runId, resource, message, step, logger } = params;
  const prefix = `[sync-step] [${resource}]`;
  const startMessage = `${prefix} starting: ${message}`;
  console.info(startMessage, { runId });
  logger?.(startMessage);
  const logId = await recordSyncLog(resource, "running", message, runId);
  try {
    await step();
    if (logId !== undefined) {
      await updateSyncLog(logId, "success", message);
    }
    const successMessage = `${prefix} completed: ${message}`;
    console.info(successMessage, { runId });
    logger?.(successMessage);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected error";
    if (logId !== undefined) {
      await updateSyncLog(logId, "failed", errorMessage);
    }
    const failureMessage = `${prefix} failed: ${errorMessage}`;
    console.error(failureMessage, { runId });
    logger?.(failureMessage);
    throw error;
  }
}

export type BackfillChunkSuccess = SyncRunResult & {
  status: "success";
};

export type BackfillChunkFailure = {
  status: "failed";
  since: string | null;
  until: string | null;
  error: string;
};

export type BackfillChunk = BackfillChunkSuccess | BackfillChunkFailure;

export type BackfillResult = {
  startDate: string | null;
  endDate: string | null;
  chunkCount: number;
  totals: SyncCounts;
  chunks: BackfillChunk[];
};

export type PrLinkBackfillResult = {
  startDate: string;
  endDate: string | null;
  startedAt: string;
  completedAt: string;
  repositoriesProcessed: number;
  pullRequestCount: number;
  latestPullRequestUpdated: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pickLatest(start: string | null, candidate: string | null) {
  if (!start) {
    return candidate;
  }

  if (!candidate) {
    return start;
  }

  return new Date(candidate) > new Date(start) ? candidate : start;
}

type SyncStrategy = "incremental" | "backfill";

function formatDayLabel(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "unknown-day";
  }
  const normalized = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  return normalized.toISOString().slice(0, 10);
}

function toRunSummaryEvent(
  summary: SyncRunResult["summary"],
): SyncRunSummaryEvent {
  return {
    counts: {
      issues: summary.counts.issues,
      discussions: summary.counts.discussions,
      pullRequests: summary.counts.pullRequests,
      reviews: summary.counts.reviews,
      comments: summary.counts.comments,
    },
    timestamps: summary.timestamps ?? undefined,
  };
}

async function buildSinceMap(base: string | null, strategy: SyncStrategy) {
  const baseIso = coerceIso(base);
  if (strategy === "backfill") {
    const map: Partial<Record<ResourceKey, string>> = {};
    if (baseIso) {
      RESOURCE_KEYS.forEach((resource) => {
        map[resource] = baseIso;
      });
    }
    return map;
  }

  const states = await Promise.all(
    RESOURCE_KEYS.map((resource) => getSyncState(resource)),
  );

  const map: Partial<Record<ResourceKey, string>> = {};

  RESOURCE_KEYS.forEach((resource, index) => {
    const state = states[index];
    const stateIso = coerceIso(state?.last_item_timestamp ?? null);
    const effective = pickLatest(baseIso, stateIso);
    if (effective) {
      map[resource] = effective;
    }
  });

  return map;
}

function buildConsoleSyncLogger(context: {
  runId: number;
  runType: SyncRunType;
  strategy: SyncStrategy;
}) {
  const prefix = `[github-sync] [run:${context.runId}] [${context.runType}] [${context.strategy}]`;
  return (message: string) => {
    console.info(`${prefix} ${message}`);
  };
}

async function resolveOrgName() {
  await ensureSchema();
  const config = await getSyncConfig();
  const org = config?.org_name ?? env.GITHUB_ORG ?? "";
  if (!org) {
    throw new Error(
      "GitHub organization is not configured. Set GITHUB_ORG or update the sync configuration.",
    );
  }

  return org;
}

async function withSyncLock<T>(handler: () => Promise<T>) {
  const scheduler = getSchedulerState();
  if (scheduler.currentRun) {
    await scheduler.currentRun.catch(() => undefined);
  }

  const runPromise = withJobLock("sync", handler);
  scheduler.currentRun = runPromise
    .then(() => undefined)
    .catch(() => undefined);

  try {
    return await runPromise;
  } finally {
    scheduler.currentRun = null;
  }
}

async function executeSync(params: {
  since: string | null;
  until?: string | null;
  logger?: SyncLogger;
  strategy?: SyncStrategy;
  runType?: SyncRunType;
}) {
  const { since, until = null, strategy = "incremental", runType } = params;
  let logger = params.logger;
  const org = await resolveOrgName();
  const startedAt = new Date().toISOString();
  const actualRunType: SyncRunType =
    runType ?? (strategy === "backfill" ? "backfill" : "automatic");

  return withSyncLock(async () => {
    await updateSyncConfig({ lastSyncStartedAt: startedAt });
    const runId = await createSyncRun({
      runType: actualRunType,
      strategy,
      since,
      until,
      startedAt,
    });

    if (runId === null) {
      throw new Error("Failed to record sync run metadata.");
    }

    if (!logger) {
      logger = buildConsoleSyncLogger({
        runId,
        runType: actualRunType,
        strategy,
      });
    }

    emitSyncEvent({
      type: "run-started",
      runId,
      runType: actualRunType,
      strategy,
      status: "running",
      since,
      until,
      startedAt,
    });

    try {
      const summary = await runCollection({
        org,
        since,
        until,
        sinceByResource: await buildSinceMap(since, strategy),
        logger,
        runId,
      });

      const collectionCompletedAt = new Date().toISOString();
      const latestResourceTimestamp = Object.values(
        summary.timestamps ?? {},
      ).reduce<string | null>(
        (latest, current) => pickLatest(latest, coerceIso(current)),
        null,
      );
      await updateSyncConfig({
        lastSuccessfulSyncAt: latestResourceTimestamp ?? collectionCompletedAt,
      });

      await logSyncStep({
        runId,
        resource: "reaction-refresh",
        message: "Refreshing reactions for unanswered attention items",
        logger,
        step: async () => {
          await refreshAttentionReactions({
            logger,
            now: new Date(),
          });
        },
      });

      await logSyncStep({
        runId,
        resource: "status-automation",
        message: "Applying issue status automation",
        logger,
        step: async () => {
          await ensureIssueStatusAutomation({
            runId,
            trigger: `sync:${actualRunType}`,
            logger,
          });
          console.info(
            "[status-automation] Applied automation after sync run",
            {
              runId,
              trigger: `sync:${actualRunType}`,
            },
          );
        },
      });

      await logSyncStep({
        runId,
        resource: "activity-snapshot",
        message: "Refreshing activity snapshot",
        logger,
        step: async () => {
          await refreshActivityItemsSnapshot({ truncate: true });
          console.info(
            "[activity-snapshot] Refreshed activity snapshot after sync",
            {
              runId,
              mode: "full",
            },
          );
        },
      });

      await logSyncStep({
        runId,
        resource: "activity-cache",
        message: "Refreshing activity caches",
        logger,
        step: async () => {
          const cacheSummary = await refreshActivityCaches({
            runId,
            reason: "sync",
          });
          console.info("[activity-cache] Refreshed caches after sync run", {
            runId,
            caches: cacheSummary,
          });
        },
      });

      await logSyncStep({
        runId,
        resource: "unanswered-mentions",
        message: "Classifying unanswered mentions",
        logger,
        step: async () => {
          const summary = await runUnansweredMentionClassification({
            logger: ({ level, message, meta }) => {
              const details = meta ? { ...meta, runId } : { runId };
              if (level === "error") {
                console.error(
                  "[unanswered-mentions] Classification error",
                  message,
                  details,
                );
              } else if (level === "warn") {
                console.warn(
                  "[unanswered-mentions] Classification warning",
                  message,
                  details,
                );
              } else {
                console.info(
                  "[unanswered-mentions] Classification info",
                  message,
                  details,
                );
              }
            },
          });

          console.info("[unanswered-mentions] Classification summary", {
            runId,
            ...summary,
          });
        },
      });

      const completedAt = new Date().toISOString();
      await updateSyncConfig({ lastSyncCompletedAt: completedAt });
      await updateSyncRunStatus(runId, "success", completedAt);
      emitSyncEvent({
        type: "run-status",
        runId,
        status: "success",
        completedAt,
      });
      emitSyncEvent({
        type: "run-completed",
        runId,
        status: "success",
        completedAt,
        summary: toRunSummaryEvent(summary),
      });

      if (actualRunType === "automatic") {
        emitSyncEvent({
          type: "attention-refresh",
          scope: "all",
          trigger: "automatic-sync",
          timestamp: completedAt,
        });
      }

      return {
        since,
        until,
        startedAt,
        completedAt,
        summary,
      } satisfies SyncRunResult;
    } catch (error) {
      const failureCompletedAt = new Date().toISOString();
      await updateSyncRunStatus(runId, "failed", failureCompletedAt);
      await updateSyncConfig({ lastSyncCompletedAt: failureCompletedAt });
      emitSyncEvent({
        type: "run-status",
        runId,
        status: "failed",
        completedAt: failureCompletedAt,
      });
      const message =
        error instanceof Error ? error.message : "Sync run failed.";
      emitSyncEvent({
        type: "run-failed",
        runId,
        status: "failed",
        finishedAt: failureCompletedAt,
        error: message,
      });
      throw error;
    }
  });
}

export async function runBackfill(
  startDateOrLogger?: string | null | SyncLogger,
  endDateOrLogger?: string | null | SyncLogger,
  loggerMaybe?: SyncLogger,
) {
  let logger: SyncLogger | undefined = loggerMaybe;

  const resolveDateArg = (
    value: string | null | SyncLogger | undefined,
  ): string | null => {
    if (typeof value === "function") {
      logger = value;
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return value ?? null;
  };

  const startDate = resolveDateArg(startDateOrLogger);
  const endDate = resolveDateArg(endDateOrLogger);

  if (typeof loggerMaybe === "function") {
    logger = loggerMaybe;
  }

  const now = new Date();
  const nowUtc = new Date(now.toISOString());

  let sinceIso: string | null = null;
  if (startDate) {
    const parsedDate = dateSchema.parse(startDate);
    const start = new Date(parsedDate);
    const startUtc = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    );
    if (startUtc.getTime() > nowUtc.getTime()) {
      throw new Error("Backfill start date must be in the past.");
    }
    sinceIso = startUtc.toISOString();
  }

  let untilIso: string | null = null;
  if (endDate) {
    const parsedEndDate = dateSchema.parse(endDate);
    const end = new Date(parsedEndDate);
    const endUtc = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    );

    if (sinceIso !== null && endUtc.getTime() < Date.parse(sinceIso)) {
      throw new Error("Backfill end date must be on or after the start date.");
    }

    if (endUtc.getTime() > nowUtc.getTime()) {
      throw new Error("Backfill end date must be in the past.");
    }

    const exclusiveEndCandidate = new Date(endUtc.getTime() + MS_PER_DAY);
    const exclusiveEnd =
      exclusiveEndCandidate.getTime() > nowUtc.getTime()
        ? new Date(nowUtc.toISOString())
        : exclusiveEndCandidate;
    if (sinceIso !== null && exclusiveEnd.getTime() <= Date.parse(sinceIso)) {
      throw new Error("Backfill range must include at least one valid moment.");
    }
    untilIso = exclusiveEnd.toISOString();
  }

  const totals: SyncCounts = {
    issues: 0,
    discussions: 0,
    pullRequests: 0,
    reviews: 0,
    comments: 0,
  };
  const chunks: BackfillChunk[] = [];

  const rangeStartLabel = sinceIso ?? "-∞";
  const rangeLabel =
    untilIso === null
      ? `${rangeStartLabel} → ∞`
      : `${rangeStartLabel} → ${untilIso}`;
  const activeLogger = logger;
  const scopedLogger = activeLogger
    ? (message: string) => activeLogger(`[${rangeLabel}) ${message}`)
    : undefined;

  try {
    const result = await executeSync({
      since: sinceIso,
      until: untilIso,
      logger: scopedLogger,
      strategy: "backfill",
    });

    totals.issues = result.summary.counts.issues;
    totals.discussions = result.summary.counts.discussions;
    totals.pullRequests = result.summary.counts.pullRequests;
    totals.reviews = result.summary.counts.reviews;
    totals.comments = result.summary.counts.comments;

    chunks.push({ status: "success", ...result });

    return {
      startDate: sinceIso,
      endDate: result.until ?? null,
      chunkCount: 1,
      totals,
      chunks,
    } satisfies BackfillResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during backfill.";
    chunks.push({
      status: "failed",
      since: sinceIso,
      until: untilIso ?? null,
      error: message,
    });

    return {
      startDate: sinceIso,
      endDate: untilIso ?? null,
      chunkCount: 1,
      totals,
      chunks,
    } satisfies BackfillResult;
  }
}

export async function runIncrementalSync(logger?: SyncLogger) {
  await ensureSchema();
  const config = await getSyncConfig();
  const since = config?.last_successful_sync_at ?? null;
  try {
    return await executeSync({ since, logger, strategy: "incremental" });
  } finally {
    scheduleNextSyncRun();
  }
}

export async function runPrLinkBackfill(
  startDate: string,
  endDate?: string | null,
  logger?: SyncLogger,
): Promise<PrLinkBackfillResult> {
  const parsedDate = dateSchema.parse(startDate);
  const start = new Date(parsedDate);
  const startUtc = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const sinceIso = startUtc.toISOString();
  let endDateIso: string | null = null;
  let untilIso: string | null = null;

  if (endDate) {
    const parsedEndDate = dateSchema.parse(endDate);
    const end = new Date(parsedEndDate);
    const endUtc = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    );

    if (endUtc.getTime() < startUtc.getTime()) {
      throw new Error(
        "PR link backfill end date must be on or after the start date.",
      );
    }

    endDateIso = endUtc.toISOString();
    const exclusiveEndUtc = new Date(endDateIso);
    exclusiveEndUtc.setUTCDate(exclusiveEndUtc.getUTCDate() + 1);
    untilIso = exclusiveEndUtc.toISOString();
  }

  return withSyncLock(async () => {
    await ensureSchema();
    const org = await resolveOrgName();
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();

    const plannedExclusiveEndUtc = untilIso
      ? new Date(untilIso)
      : new Date(
          Math.max(startUtc.getTime() + MS_PER_DAY, startedAtDate.getTime()),
        );
    if (Number.isNaN(plannedExclusiveEndUtc.getTime())) {
      throw new Error("Invalid PR link backfill end boundary.");
    }
    const startDayLabel = formatDayLabel(startUtc);

    logger?.(
      `Starting PR link backfill for ${org} (period: ${startDayLabel}).`,
    );

    const runId = await createSyncRun({
      runType: "backfill",
      strategy: "backfill",
      since: sinceIso,
      until: untilIso,
      startedAt,
    });

    if (runId === null) {
      throw new Error("Failed to record PR link backfill run metadata.");
    }

    emitSyncEvent({
      type: "run-started",
      runId,
      runType: "backfill",
      strategy: "backfill",
      status: "running",
      since: sinceIso,
      until: untilIso,
      startedAt,
    });

    try {
      const exclusiveEndUtc = plannedExclusiveEndUtc;

      let cursor = startUtc;
      let chunkIndex = 0;
      let totalPullRequestCount = 0;
      let repositoriesProcessed = 0;
      let latestPullRequestUpdated: string | null = null;
      let lastChunkDayLabel: string | null = null;

      while (cursor.getTime() < exclusiveEndUtc.getTime()) {
        const nextCursorMs = Math.min(
          exclusiveEndUtc.getTime(),
          cursor.getTime() + MS_PER_DAY,
        );
        if (nextCursorMs <= cursor.getTime()) {
          break;
        }
        const chunkUntil = new Date(nextCursorMs);
        const chunkSinceIso = cursor.toISOString();
        const chunkUntilIso = chunkUntil.toISOString();
        const chunkDayLabel = formatDayLabel(chunkSinceIso);

        chunkIndex += 1;
        logger?.(
          `Collecting PR link chunk #${chunkIndex} for ${org} (period: ${chunkDayLabel}).`,
        );

        const chunkSummary = await collectPullRequestLinks({
          org,
          sinceByResource: { pull_requests: chunkSinceIso },
          until: chunkUntilIso,
          logger,
        });

        totalPullRequestCount += chunkSummary.pullRequestCount;
        repositoriesProcessed = Math.max(
          repositoriesProcessed,
          chunkSummary.repositoriesProcessed,
        );
        latestPullRequestUpdated = pickLatest(
          latestPullRequestUpdated,
          chunkSummary.latestPullRequestUpdated,
        );

        cursor = chunkUntil;
        lastChunkDayLabel = chunkDayLabel;
      }

      emitSyncEvent({
        type: "log-started",
        logId: runId * 1000,
        runId,
        resource: "pull_request_links",
        status: "running",
        message: "PR 링크 갱신 실행 중",
        startedAt,
      });

      const completedAtDate = new Date();
      const completedAt = completedAtDate.toISOString();
      await updateSyncRunStatus(runId, "success", completedAt);
      emitSyncEvent({
        type: "run-status",
        runId,
        status: "success",
        completedAt,
      });
      emitSyncEvent({
        type: "run-completed",
        runId,
        status: "success",
        completedAt,
        summary: {
          counts: {
            issues: 0,
            discussions: 0,
            pullRequests: totalPullRequestCount,
            reviews: 0,
            comments: 0,
          },
          timestamps: {
            pullRequests: latestPullRequestUpdated ?? null,
          },
        },
      });

      emitSyncEvent({
        type: "log-updated",
        logId: runId * 1000,
        runId,
        resource: "pull_request_links",
        status: "success",
        message: `${repositoriesProcessed}개 저장소, PR ${totalPullRequestCount}건 링크 갱신 완료`,
        finishedAt: completedAt,
      });

      const completionDayLabel =
        lastChunkDayLabel ??
        (latestPullRequestUpdated
          ? formatDayLabel(latestPullRequestUpdated)
          : startDayLabel);

      logger?.(
        `Completed PR link backfill for ${org} (period: ${completionDayLabel}). Processed ${totalPullRequestCount} pull requests across ${repositoriesProcessed} repositories.`,
      );

      return {
        startDate: sinceIso,
        endDate: endDateIso,
        startedAt,
        completedAt,
        repositoriesProcessed,
        pullRequestCount: totalPullRequestCount,
        latestPullRequestUpdated,
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      await updateSyncRunStatus(runId, "failed", failedAt);
      emitSyncEvent({
        type: "run-status",
        runId,
        status: "failed",
        completedAt: failedAt,
      });
      const message =
        error instanceof Error ? error.message : "PR link backfill failed.";
      emitSyncEvent({
        type: "run-failed",
        runId,
        status: "failed",
        finishedAt: failedAt,
        error: message,
      });
      emitSyncEvent({
        type: "log-updated",
        logId: runId * 1000,
        runId,
        resource: "pull_request_links",
        status: "failed",
        message,
        finishedAt: failedAt,
      });
      throw error;
    }
  });
}

export async function enableAutomaticSync(options?: {
  intervalMinutes?: number;
  logger?: SyncLogger;
}) {
  await ensureSchema();
  const config = await getSyncConfig();
  const interval =
    options?.intervalMinutes ??
    config?.sync_interval_minutes ??
    env.SYNC_INTERVAL_MINUTES;
  if (!interval) {
    throw new Error("Sync interval is not configured.");
  }

  await updateSyncConfig({
    autoSyncEnabled: true,
    syncIntervalMinutes: interval,
  });

  startScheduler(interval, {
    initialDelayMs: interval * 60 * 1000,
  });
  return runIncrementalSync(options?.logger);
}

export async function disableAutomaticSync() {
  stopScheduler();
  await ensureSchema();
  await updateSyncConfig({ autoSyncEnabled: false });
}

// Register the sync runner so the scheduler can trigger incremental syncs
// without a circular dependency.
registerSyncRunner(() => runIncrementalSync());

void initializeScheduler().catch((error) => {
  console.error("[github-dashboard] Failed to initialize scheduler", error);
});

// ---- Barrel re-exports ----
// Preserve existing import paths for consumers using @/lib/sync/service.

export {
  type DashboardStats,
  fetchDashboardStats,
  fetchSyncConfig,
  fetchSyncStatus,
  type SyncStatus,
  updateOrganization,
  updateSyncSettings,
} from "@/lib/sync/config";
export { cleanupStuckSyncRuns, resetData } from "@/lib/sync/reset";
export { initializeScheduler } from "@/lib/sync/scheduler";
