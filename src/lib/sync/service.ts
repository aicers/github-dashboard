import { z } from "zod";

import { refreshActivityCaches } from "@/lib/activity/cache";
import { isValidDateTimeDisplayFormat } from "@/lib/date-time-format";
import { ensureSchema } from "@/lib/db";
import {
  cleanupRunningSyncRuns,
  createSyncRun,
  getDashboardStats,
  getDataFreshness,
  getLatestSyncLogs,
  getLatestSyncRuns,
  getSyncConfig,
  getSyncState,
  resetData as resetDatabase,
  type SyncRunSummary,
  type SyncRunType,
  updateSyncConfig,
  updateSyncRunStatus,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import type { ResourceKey, SyncLogger } from "@/lib/github/collectors";
import {
  collectPullRequestLinks,
  RESOURCE_KEYS,
  runCollection,
} from "@/lib/github/collectors";
import { emitSyncEvent } from "@/lib/sync/event-bus";
import type { SyncRunSummaryEvent } from "@/lib/sync/events";

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

type SchedulerState = {
  timer: NodeJS.Timeout | null;
  currentRun: Promise<void> | null;
  intervalMs: number | null;
  isEnabled: boolean;
};

type SyncRunResult = {
  since: string | null;
  until: string | null;
  startedAt: string;
  completedAt: string;
  summary: Awaited<ReturnType<typeof runCollection>>;
};

type SyncCounts = SyncRunResult["summary"]["counts"];

export type BackfillChunkSuccess = SyncRunResult & {
  status: "success";
};

export type BackfillChunkFailure = {
  status: "failed";
  since: string;
  until: string;
  error: string;
};

export type BackfillChunk = BackfillChunkSuccess | BackfillChunkFailure;

export type BackfillResult = {
  startDate: string;
  endDate: string;
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

export type SyncStatus = {
  config: Awaited<ReturnType<typeof getSyncConfig>>;
  runs: SyncRunSummary[];
  logs: Awaited<ReturnType<typeof getLatestSyncLogs>>;
  dataFreshness: Awaited<ReturnType<typeof getDataFreshness>>;
};

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

type SchedulerGlobal = typeof globalThis & {
  __githubDashboardScheduler?: SchedulerState;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getSchedulerState() {
  const globalWithScheduler = globalThis as SchedulerGlobal;
  if (!globalWithScheduler.__githubDashboardScheduler) {
    globalWithScheduler.__githubDashboardScheduler = {
      timer: null,
      currentRun: null,
      intervalMs: null,
      isEnabled: false,
    };
  }

  return globalWithScheduler.__githubDashboardScheduler;
}

function scheduleNextRun(delayMs: number) {
  const scheduler = getSchedulerState();
  if (!scheduler.isEnabled || scheduler.intervalMs === null) {
    return;
  }

  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
  }

  scheduler.timer = setTimeout(
    () => {
      scheduler.timer = null;
      void runIncrementalSync().catch((error) => {
        console.error("[github-dashboard] Automatic sync failed", error);
      });
    },
    Math.max(0, delayMs),
  );
}

async function computeInitialDelay(intervalMs: number) {
  try {
    const config = await getSyncConfig();
    const lastCompletedIso = coerceIso(config?.last_sync_completed_at ?? null);
    if (!lastCompletedIso) {
      return 0;
    }

    const completedMs = new Date(lastCompletedIso).getTime();
    if (Number.isNaN(completedMs)) {
      return intervalMs;
    }

    const elapsed = Date.now() - completedMs;
    if (elapsed >= intervalMs) {
      return 0;
    }

    return intervalMs - elapsed;
  } catch (_error) {
    return intervalMs;
  }
}

async function withSyncLock<T>(handler: () => Promise<T>) {
  const scheduler = getSchedulerState();
  if (scheduler.currentRun) {
    await scheduler.currentRun;
  }

  const runPromise = handler();
  scheduler.currentRun = runPromise
    .then(() => {
      scheduler.currentRun = null;
    })
    .catch(() => {
      scheduler.currentRun = null;
    });

  try {
    return await runPromise;
  } finally {
    scheduler.currentRun = null;
  }
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

function coerceIso(value: unknown) {
  if (!value) {
    return null;
  }

  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

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

async function buildSinceMap(base: string | null, _strategy: SyncStrategy) {
  const baseIso = coerceIso(base);
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

async function executeSync(params: {
  since: string | null;
  until?: string | null;
  logger?: SyncLogger;
  strategy?: SyncStrategy;
  runType?: SyncRunType;
}) {
  const {
    since,
    until = null,
    logger,
    strategy = "incremental",
    runType,
  } = params;
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

      const completedAt = new Date().toISOString();
      const latestResourceTimestamp = Object.values(
        summary.timestamps ?? {},
      ).reduce<string | null>(
        (latest, current) => pickLatest(latest, coerceIso(current)),
        null,
      );
      await updateSyncConfig({
        lastSyncCompletedAt: completedAt,
        lastSuccessfulSyncAt: latestResourceTimestamp ?? completedAt,
      });
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

      try {
        const cacheSummary = await refreshActivityCaches({
          runId,
          reason: "sync",
        });
        console.info("[activity-cache] Refreshed caches after sync run", {
          runId,
          caches: cacheSummary,
        });
      } catch (cacheError) {
        console.error(
          "[activity-cache] Failed to refresh caches after sync run",
          cacheError,
        );
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

function startScheduler(
  intervalMinutes: number,
  options?: { initialDelayMs?: number },
) {
  const scheduler = getSchedulerState();
  const intervalMs = intervalMinutes * 60 * 1000;

  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
    scheduler.timer = null;
  }

  scheduler.intervalMs = intervalMs;
  scheduler.isEnabled = true;

  const scheduleInitial = async () => {
    const delay =
      options?.initialDelayMs ?? (await computeInitialDelay(intervalMs));
    scheduleNextRun(delay);
  };

  void scheduleInitial();
}

function stopScheduler() {
  const scheduler = getSchedulerState();
  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
    scheduler.timer = null;
  }
  scheduler.intervalMs = null;
  scheduler.isEnabled = false;
}

export async function initializeScheduler() {
  await ensureSchema();
  const config = await getSyncConfig();
  if (config?.auto_sync_enabled) {
    startScheduler(
      config.sync_interval_minutes ?? env.SYNC_INTERVAL_MINUTES ?? 60,
    );
  }
}

export async function runBackfill(startDate: string, logger?: SyncLogger) {
  const parsedDate = dateSchema.parse(startDate);
  const start = new Date(parsedDate);
  const startUtc = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const now = new Date();
  const nowUtc = new Date(now.toISOString());

  if (startUtc.getTime() > nowUtc.getTime()) {
    throw new Error("Backfill start date must be in the past.");
  }

  const totals: SyncCounts = {
    issues: 0,
    discussions: 0,
    pullRequests: 0,
    reviews: 0,
    comments: 0,
  };
  const chunks: BackfillChunk[] = [];

  let cursor = startUtc;

  while (cursor.getTime() <= nowUtc.getTime()) {
    const next = new Date(cursor.toISOString());
    next.setUTCDate(next.getUTCDate() + 1);
    const chunkEnd = next.getTime() <= nowUtc.getTime() ? next : nowUtc;

    if (cursor.getTime() >= chunkEnd.getTime()) {
      break;
    }

    const sinceIso = cursor.toISOString();
    const untilIso = chunkEnd.toISOString();
    const chunkLogger = logger
      ? (message: string) => logger(`[${sinceIso} → ${untilIso}) ${message}`)
      : undefined;

    try {
      const result = await executeSync({
        since: sinceIso,
        until: untilIso,
        logger: chunkLogger,
        strategy: "backfill",
      });

      chunks.push({ status: "success", ...result });

      const counts = result.summary.counts;
      totals.issues += counts.issues;
      totals.discussions += counts.discussions;
      totals.pullRequests += counts.pullRequests;
      totals.reviews += counts.reviews;
      totals.comments += counts.comments;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error during backfill chunk.";
      chunks.push({
        status: "failed",
        since: sinceIso,
        until: untilIso,
        error: message,
      });
      break;
    }

    if (chunkEnd.getTime() >= nowUtc.getTime()) {
      break;
    }

    cursor = chunkEnd;
  }

  return {
    startDate: startUtc.toISOString(),
    endDate: nowUtc.toISOString(),
    chunkCount: chunks.length,
    totals,
    chunks,
  } satisfies BackfillResult;
}

export async function runIncrementalSync(logger?: SyncLogger) {
  await ensureSchema();
  const config = await getSyncConfig();
  const since = config?.last_successful_sync_at ?? null;
  try {
    return await executeSync({ since, logger, strategy: "incremental" });
  } finally {
    const scheduler = getSchedulerState();
    if (scheduler.isEnabled && scheduler.intervalMs !== null) {
      scheduleNextRun(scheduler.intervalMs);
    }
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

export async function updateOrganization(org: string) {
  const trimmed = org.trim();
  if (!trimmed) {
    throw new Error("Organization name cannot be empty.");
  }

  await ensureSchema();
  await updateSyncConfig({ orgName: trimmed });
}

export async function updateSyncSettings(params: {
  orgName?: string;
  syncIntervalMinutes?: number;
  timezone?: string;
  weekStart?: "sunday" | "monday";
  excludedRepositories?: string[];
  excludedPeople?: string[];
  allowedTeams?: string[];
  allowedUsers?: string[];
  dateTimeFormat?: string;
}) {
  await ensureSchema();

  if (params.orgName !== undefined) {
    await updateOrganization(params.orgName);
  }

  if (params.syncIntervalMinutes !== undefined) {
    const interval = params.syncIntervalMinutes;
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error("Sync interval must be a positive number of minutes.");
    }

    await updateSyncConfig({ syncIntervalMinutes: interval });
    const config = await getSyncConfig();
    if (config?.auto_sync_enabled) {
      startScheduler(interval);
    }
  }

  if (params.timezone !== undefined) {
    const tz = params.timezone.trim();
    if (!tz) {
      throw new Error("Timezone cannot be empty.");
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    } catch (_error) {
      throw new Error("Invalid timezone identifier.");
    }

    await updateSyncConfig({ timezone: tz });
  }

  if (params.weekStart !== undefined) {
    const value = params.weekStart;
    if (value !== "sunday" && value !== "monday") {
      throw new Error("Week start must be either 'sunday' or 'monday'.");
    }

    await updateSyncConfig({ weekStart: value });
  }

  if (params.excludedRepositories !== undefined) {
    const normalized = Array.from(
      new Set(
        params.excludedRepositories
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    await updateSyncConfig({ excludedRepositories: normalized });
  }

  if (params.excludedPeople !== undefined) {
    const normalized = Array.from(
      new Set(
        params.excludedPeople
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    await updateSyncConfig({ excludedUsers: normalized });
  }

  if (params.allowedTeams !== undefined) {
    const normalized = Array.from(
      new Set(
        params.allowedTeams
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
      ),
    );

    await updateSyncConfig({ allowedTeams: normalized });
  }

  if (params.allowedUsers !== undefined) {
    const normalized = Array.from(
      new Set(
        params.allowedUsers
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    await updateSyncConfig({ allowedUsers: normalized });
  }

  if (params.dateTimeFormat !== undefined) {
    const format = params.dateTimeFormat.trim();
    if (!isValidDateTimeDisplayFormat(format)) {
      throw new Error("Unsupported date-time display format.");
    }

    await updateSyncConfig({ dateTimeFormat: format });
  }
}

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

export async function fetchSyncStatus(): Promise<SyncStatus> {
  await ensureSchema();
  const [config, runs, logs, dataFreshness] = await Promise.all([
    getSyncConfig(),
    getLatestSyncRuns(36),
    getLatestSyncLogs(36),
    getDataFreshness(),
  ]);

  return { config, runs, logs, dataFreshness };
}

export async function fetchSyncConfig() {
  await ensureSchema();
  return getSyncConfig();
}

export async function fetchDashboardStats() {
  await ensureSchema();
  return getDashboardStats();
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

void initializeScheduler().catch((error) => {
  console.error("[github-dashboard] Failed to initialize scheduler", error);
});
