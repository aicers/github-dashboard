import { z } from "zod";

import { ensureSchema } from "@/lib/db";
import {
  getDashboardStats,
  getDataFreshness,
  getLatestSyncLogs,
  getSyncConfig,
  getSyncState,
  resetData as resetDatabase,
  updateSyncConfig,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import type { ResourceKey, SyncLogger } from "@/lib/github/collectors";
import { RESOURCE_KEYS, runCollection } from "@/lib/github/collectors";

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

export type SyncStatus = {
  config: Awaited<ReturnType<typeof getSyncConfig>>;
  logs: Awaited<ReturnType<typeof getLatestSyncLogs>>;
  dataFreshness: Awaited<ReturnType<typeof getDataFreshness>>;
};

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

type SchedulerGlobal = typeof globalThis & {
  __githubDashboardScheduler?: SchedulerState;
};

function getSchedulerState() {
  const globalWithScheduler = globalThis as SchedulerGlobal;
  if (!globalWithScheduler.__githubDashboardScheduler) {
    globalWithScheduler.__githubDashboardScheduler = {
      timer: null,
      currentRun: null,
    };
  }

  return globalWithScheduler.__githubDashboardScheduler;
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
}) {
  const { since, until = null, logger, strategy = "incremental" } = params;
  const org = await resolveOrgName();
  const startedAt = new Date().toISOString();

  return withSyncLock(async () => {
    await updateSyncConfig({ lastSyncStartedAt: startedAt });

    try {
      const summary = await runCollection({
        org,
        since,
        until,
        sinceByResource: await buildSinceMap(since, strategy),
        logger,
      });

      const completedAt = new Date().toISOString();
      await updateSyncConfig({
        lastSyncCompletedAt: completedAt,
        lastSuccessfulSyncAt: completedAt,
      });

      return {
        since,
        until,
        startedAt,
        completedAt,
        summary,
      } satisfies SyncRunResult;
    } catch (error) {
      await updateSyncConfig({ lastSyncCompletedAt: new Date().toISOString() });
      throw error;
    }
  });
}

function startScheduler(intervalMinutes: number) {
  const scheduler = getSchedulerState();
  const intervalMs = intervalMinutes * 60 * 1000;

  if (scheduler.timer) {
    clearInterval(scheduler.timer);
    scheduler.timer = null;
  }

  scheduler.timer = setInterval(() => {
    void runIncrementalSync().catch((error) => {
      console.error("[github-dashboard] Automatic sync failed", error);
    });
  }, intervalMs);
}

function stopScheduler() {
  const scheduler = getSchedulerState();
  if (scheduler.timer) {
    clearInterval(scheduler.timer);
    scheduler.timer = null;
  }
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
  return executeSync({ since, logger, strategy: "incremental" });
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

  startScheduler(interval);
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
  const [config, logs, dataFreshness] = await Promise.all([
    getSyncConfig(),
    getLatestSyncLogs(20),
    getDataFreshness(),
  ]);

  return { config, logs, dataFreshness };
}

export async function fetchDashboardStats() {
  await ensureSchema();
  return getDashboardStats();
}

void initializeScheduler().catch((error) => {
  console.error("[github-dashboard] Failed to initialize scheduler", error);
});
