import { ensureSchema } from "@/lib/db";
import {
  getSyncConfig,
  recordSyncLog,
  updateSyncConfig,
  updateSyncLog,
} from "@/lib/db/operations";
import type { RepositoryRealignmentSummary } from "@/lib/github/repository-realignment";
import { realignRepositoryMismatches } from "@/lib/github/repository-realignment";
import { withJobLock } from "@/lib/jobs/lock";

type TransferSchedulerState = {
  timer: NodeJS.Timeout | null;
  nextRunAt: string | null;
  currentRun: Promise<void> | null;
  isScheduling: boolean;
  isWaiting: boolean;
  waitStartedAt: number | null;
};

type SchedulerGlobal = typeof globalThis & {
  __githubDashboardTransferScheduler?: TransferSchedulerState;
};

export type TransferSyncRuntimeInfo = {
  schedule: {
    hourLocal: number;
    minuteLocal: number;
    timezone: string;
    nextRunAt: string | null;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  };
  isRunning: boolean;
  isWaiting: boolean;
};

type TransferSyncRunResult = {
  summary: RepositoryRealignmentSummary;
  startedAt: string;
  completedAt: string;
};

type TransferRunTrigger = "automatic" | "manual";

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const TRANSFER_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

function getSchedulerState(): TransferSchedulerState {
  const globalWithScheduler = globalThis as SchedulerGlobal;
  if (!globalWithScheduler.__githubDashboardTransferScheduler) {
    globalWithScheduler.__githubDashboardTransferScheduler = {
      timer: null,
      nextRunAt: null,
      currentRun: null,
      isScheduling: false,
      isWaiting: false,
      waitStartedAt: null,
    };
  }

  return globalWithScheduler.__githubDashboardTransferScheduler;
}

function getDateTimeFormat(timeZone: string) {
  if (!dtfCache.has(timeZone)) {
    dtfCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  }

  const formatter = dtfCache.get(timeZone);
  if (!formatter) {
    throw new Error(`Failed to resolve date-time formatter for ${timeZone}`);
  }

  return formatter;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = getDateTimeFormat(timeZone);
  const parts = formatter.formatToParts(date);
  const bucket = new Map(parts.map((part) => [part.type, part.value]));

  const year = Number.parseInt(bucket.get("year") ?? "0", 10);
  const month = Number.parseInt(bucket.get("month") ?? "1", 10);
  const day = Number.parseInt(bucket.get("day") ?? "1", 10);
  const hour = Number.parseInt(bucket.get("hour") ?? "0", 10);
  const minute = Number.parseInt(bucket.get("minute") ?? "0", 10);
  const second = Number.parseInt(bucket.get("second") ?? "0", 10);

  return { year, month, day, hour, minute, second };
}

function zonedDateTimeToUtc(
  components: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
) {
  const { year, month, day, hour } = components;
  const minute = components.minute ?? 0;
  const second = components.second ?? 0;
  const initial = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );
  const offsetMinutes = getOffsetMinutes(initial, timeZone);
  return new Date(initial.getTime() - offsetMinutes * 60 * 1000);
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const localTs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (localTs - date.getTime()) / 60000;
}

function toSafeHour(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 4;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return 0;
  }
  if (normalized > 23) {
    return 23;
  }
  return normalized;
}

function toSafeMinute(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return 0;
  }
  if (normalized > 59) {
    return 59;
  }
  return normalized;
}

function computeNextRunDate(
  hourLocal: number,
  minuteLocal: number,
  timeZone: string,
) {
  const now = new Date();
  const nowParts = getZonedParts(now, timeZone);
  const todayCandidate = zonedDateTimeToUtc(
    {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: hourLocal,
      minute: minuteLocal,
      second: 0,
    },
    timeZone,
  );

  if (todayCandidate.getTime() > now.getTime()) {
    return todayCandidate;
  }

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = getZonedParts(tomorrow, timeZone);
  return zonedDateTimeToUtc(
    {
      year: tomorrowParts.year,
      month: tomorrowParts.month,
      day: tomorrowParts.day,
      hour: hourLocal,
      minute: minuteLocal,
      second: 0,
    },
    timeZone,
  );
}

function scheduleNextRun(nextRun: Date | null) {
  const scheduler = getSchedulerState();

  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
    scheduler.timer = null;
  }

  scheduler.nextRunAt = nextRun ? nextRun.toISOString() : null;
  if (!nextRun) {
    return;
  }

  const delay = Math.max(0, nextRun.getTime() - Date.now());
  scheduler.timer = setTimeout(() => {
    scheduler.timer = null;
    void runScheduledTransferSync().catch((error) => {
      console.error("[transfer-sync] Automatic run failed", error);
    });
  }, delay);
}

async function refreshScheduler() {
  const scheduler = getSchedulerState();
  if (scheduler.isScheduling) {
    return;
  }

  scheduler.isScheduling = true;
  try {
    await ensureSchema();
    const config = await getSyncConfig();
    if (!config) {
      scheduleNextRun(null);
      return;
    }

    const hour = toSafeHour(config.transfer_sync_hour_local);
    const minute = toSafeMinute(config.transfer_sync_minute_local);
    const timezone = config.transfer_sync_timezone ?? config.timezone ?? "UTC";
    const nextRun = computeNextRunDate(hour, minute, timezone);
    scheduleNextRun(nextRun);
  } catch (error) {
    console.error("[transfer-sync] Failed to refresh scheduler", error);
    scheduleNextRun(null);
  } finally {
    scheduler.isScheduling = false;
  }
}

async function withTrackedRun<T>(handler: () => Promise<T>) {
  const scheduler = getSchedulerState();
  if (scheduler.currentRun) {
    await scheduler.currentRun.catch(() => undefined);
  }

  const runPromise = handler().finally(() => {
    scheduler.currentRun = null;
  });

  scheduler.currentRun = runPromise.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await runPromise;
  } finally {
    scheduler.currentRun = null;
  }
}

async function runScheduledTransferSync() {
  await runTransferSync({ trigger: "automatic" });
}

function buildLogMessage(trigger: TransferRunTrigger, actorId?: string | null) {
  if (trigger === "automatic") {
    return "Scheduled transfer sync started.";
  }
  if (actorId) {
    return `Manual transfer sync started by ${actorId}.`;
  }
  return "Manual transfer sync started.";
}

export async function runTransferSync(options?: {
  trigger?: TransferRunTrigger;
  actorId?: string | null;
  waitTimeoutMs?: number;
}): Promise<TransferSyncRunResult> {
  const trigger: TransferRunTrigger = options?.trigger ?? "manual";
  const waitTimeoutMs =
    typeof options?.waitTimeoutMs === "number" && options.waitTimeoutMs > 0
      ? options.waitTimeoutMs
      : TRANSFER_WAIT_TIMEOUT_MS;
  const scheduler = getSchedulerState();
  scheduler.isWaiting = true;
  scheduler.waitStartedAt = Date.now();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    if (!scheduler.isWaiting) {
      return;
    }
    timedOut = true;
    scheduler.isWaiting = false;
    scheduler.waitStartedAt = null;
    const completedAt = new Date().toISOString();
    const timeoutMinutes = Math.round(waitTimeoutMs / 60000);
    void updateSyncConfig({
      transferSyncLastCompletedAt: completedAt,
      transferSyncLastStatus: "failed",
      transferSyncLastError: `Transfer sync timed out waiting ${timeoutMinutes} minutes for other jobs.`,
    });
  }, waitTimeoutMs);

  return withTrackedRun(async () => {
    await ensureSchema();

    await updateSyncConfig({
      transferSyncLastStartedAt: null,
      transferSyncLastCompletedAt: null,
      transferSyncLastStatus: "waiting",
      transferSyncLastError: null,
    });

    try {
      const result = await withJobLock("transfer", async () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (timedOut) {
          throw new Error(
            "Transfer sync timed out while waiting for other jobs.",
          );
        }

        scheduler.isWaiting = false;
        scheduler.waitStartedAt = null;
        const startedAt = new Date().toISOString();

        await updateSyncConfig({
          transferSyncLastStartedAt: startedAt,
          transferSyncLastStatus: "running",
          transferSyncLastError: null,
        });

        const logId = await recordSyncLog(
          "transfer-sync",
          "running",
          buildLogMessage(trigger, options?.actorId),
        );

        try {
          const summary = await realignRepositoryMismatches({
            refreshArtifacts: true,
            mode: trigger,
            logger: (message) => console.info("[transfer-sync]", message),
          });

          const completedAt = new Date().toISOString();

          await updateSyncConfig({
            transferSyncLastCompletedAt: completedAt,
            transferSyncLastStatus: "success",
            transferSyncLastError: null,
          });

          if (logId !== undefined) {
            await updateSyncLog(
              logId,
              "success",
              `Updated ${summary.updated} nodes (candidates: ${summary.candidates}).`,
            );
          }

          console.info("[transfer-sync] Completed", {
            trigger,
            updated: summary.updated,
            candidates: summary.candidates,
          });

          return { summary, startedAt, completedAt };
        } catch (error) {
          const completedAt = new Date().toISOString();
          const message =
            error instanceof Error ? error.message : "Transfer sync failed.";

          await updateSyncConfig({
            transferSyncLastCompletedAt: completedAt,
            transferSyncLastStatus: "failed",
            transferSyncLastError: message,
          });

          if (logId !== undefined) {
            await updateSyncLog(logId, "failed", message);
          }

          console.error("[transfer-sync] Failed", { trigger, error });
          throw error;
        }
      });

      return result;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      scheduler.isWaiting = false;
      scheduler.waitStartedAt = null;
      await refreshScheduler();
    }
  });
}

export async function updateTransferSyncSchedule(params: {
  hourLocal: number;
  minuteLocal: number;
  timezone: string;
}) {
  await ensureSchema();

  const hour = Math.round(params.hourLocal);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    throw new Error("Transfer sync hour must be between 0 and 23.");
  }

  const minute = Math.round(params.minuteLocal);
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    throw new Error("Transfer sync minute must be between 0 and 59.");
  }

  const tz = params.timezone.trim();
  if (!tz) {
    throw new Error("Timezone cannot be empty.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
  } catch (_error) {
    throw new Error("Invalid timezone identifier.");
  }

  await updateSyncConfig({
    transferSyncHourLocal: hour,
    transferSyncMinuteLocal: minute,
    transferSyncTimezone: tz,
  });

  await refreshScheduler();
}

export async function getTransferSyncRuntimeInfo(): Promise<TransferSyncRuntimeInfo> {
  await ensureSchema();

  const config = await getSyncConfig();
  const scheduler = getSchedulerState();

  const hour = toSafeHour(config?.transfer_sync_hour_local);
  const minute = toSafeMinute(config?.transfer_sync_minute_local);
  const timezone = config?.transfer_sync_timezone ?? config?.timezone ?? "UTC";

  return {
    schedule: {
      hourLocal: hour,
      minuteLocal: minute,
      timezone,
      nextRunAt: scheduler.nextRunAt,
      lastStartedAt: config?.transfer_sync_last_started_at ?? null,
      lastCompletedAt: config?.transfer_sync_last_completed_at ?? null,
      lastStatus: config?.transfer_sync_last_status ?? null,
      lastError: config?.transfer_sync_last_error ?? null,
    },
    isRunning: Boolean(scheduler.currentRun),
    isWaiting: scheduler.isWaiting,
  };
}

export async function initializeTransferSyncScheduler() {
  await refreshScheduler();
}

void initializeTransferSyncScheduler().catch((error) => {
  console.error("[transfer-sync] Failed to initialize scheduler", error);
});
