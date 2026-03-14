import { ensureSchema } from "@/lib/db";
import { getSyncConfig } from "@/lib/db/operations";
import { env } from "@/lib/env";
import { coerceIso } from "@/lib/sync/internal";

type SchedulerState = {
  timer: NodeJS.Timeout | null;
  currentRun: Promise<void> | null;
  intervalMs: number | null;
  isEnabled: boolean;
  runSync: (() => Promise<unknown>) | null;
};

type SchedulerGlobal = typeof globalThis & {
  __githubDashboardScheduler?: SchedulerState;
};

export function getSchedulerState() {
  const globalWithScheduler = globalThis as SchedulerGlobal;
  if (!globalWithScheduler.__githubDashboardScheduler) {
    globalWithScheduler.__githubDashboardScheduler = {
      timer: null,
      currentRun: null,
      intervalMs: null,
      isEnabled: false,
      runSync: null,
    };
  }

  return globalWithScheduler.__githubDashboardScheduler;
}

export function registerSyncRunner(fn: () => Promise<unknown>) {
  getSchedulerState().runSync = fn;
}

function shouldLogSchedulerError(error: unknown) {
  if (
    process.env.NODE_ENV === "test" &&
    error instanceof Error &&
    error.message.includes("GitHub token missing")
  ) {
    return false;
  }

  return true;
}

function scheduleNextRun(delayMs: number) {
  const scheduler = getSchedulerState();
  if (!scheduler.isEnabled || scheduler.intervalMs === null) {
    return;
  }

  const { runSync } = scheduler;
  if (!runSync) {
    return;
  }

  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
  }

  scheduler.timer = setTimeout(
    () => {
      scheduler.timer = null;
      void runSync().catch((error) => {
        if (shouldLogSchedulerError(error)) {
          console.error("[github-dashboard] Automatic sync failed", error);
        }
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

export function startScheduler(
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

export function stopScheduler() {
  const scheduler = getSchedulerState();
  if (scheduler.timer) {
    clearTimeout(scheduler.timer);
    scheduler.timer = null;
  }
  scheduler.intervalMs = null;
  scheduler.isEnabled = false;
}

export function scheduleNextSyncRun() {
  const scheduler = getSchedulerState();
  if (scheduler.isEnabled && scheduler.intervalMs !== null) {
    scheduleNextRun(scheduler.intervalMs);
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
