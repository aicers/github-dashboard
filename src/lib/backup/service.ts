import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { ensureSchema } from "@/lib/db";
import {
  createBackupRecord,
  type DbBackupRecord,
  type DbBackupTrigger,
  deleteBackupRecord,
  getBackupRecord,
  getSyncConfig,
  listBackups,
  markBackupFailure,
  markBackupRestored,
  markBackupSuccess,
  updateSyncConfig,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import { withJobLock } from "@/lib/jobs/lock";

type BackupSchedulerState = {
  timer: NodeJS.Timeout | null;
  nextRunAt: string | null;
  currentRun: Promise<void> | null;
  isScheduling: boolean;
};

type BackupScheduleConfig = {
  enabled: boolean;
  hourLocal: number;
  timezone: string;
};

export type BackupRuntimeInfo = {
  directory: string;
  retentionCount: number;
  schedule: BackupScheduleConfig & {
    nextRunAt: string | null;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  };
  records: DbBackupRecord[];
};

type SchedulerGlobal = typeof globalThis & {
  __githubDashboardBackupScheduler?: BackupSchedulerState;
};

const DEFAULT_BACKUP_HOUR = 2;

function getSchedulerState(): BackupSchedulerState {
  const globalWithScheduler = globalThis as SchedulerGlobal;
  if (!globalWithScheduler.__githubDashboardBackupScheduler) {
    globalWithScheduler.__githubDashboardBackupScheduler = {
      timer: null,
      nextRunAt: null,
      currentRun: null,
      isScheduling: false,
    };
  }

  return globalWithScheduler.__githubDashboardBackupScheduler;
}

function toSafeHour(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BACKUP_HOUR;
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

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

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

function getZonedParts(date: Date, timeZone: string): ZonedParts {
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

function computeNextRunDate(hourLocal: number, timeZone: string) {
  const now = new Date();
  const nowParts = getZonedParts(now, timeZone);
  const todayCandidate = zonedDateTimeToUtc(
    {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: hourLocal,
      minute: 0,
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
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

async function ensureBackupDirectory(directory: string) {
  try {
    await access(directory, fsConstants.W_OK);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(directory, { recursive: true });
  await access(directory, fsConstants.W_OK);
}

function timestampLabel() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hours = pad(now.getUTCHours());
  const minutes = pad(now.getUTCMinutes());
  const seconds = pad(now.getUTCSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildBackupFilename() {
  return `db-backup-${timestampLabel()}.dump`;
}

function runChildProcess(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd ?? process.cwd(),
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function executeBackup(filePath: string) {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Cannot execute database backup.",
    );
  }

  const args = [
    "--format=custom",
    "--file",
    filePath,
    "--no-owner",
    "--no-privileges",
    env.DATABASE_URL,
  ];

  await runChildProcess("pg_dump", args);
}

async function executeRestore(filePath: string) {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Cannot restore database backup.",
    );
  }

  const args = [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    env.DATABASE_URL,
    filePath,
  ];

  await runChildProcess("pg_restore", args);
}

async function pruneBackups(retentionCount: number) {
  if (!Number.isFinite(retentionCount) || retentionCount <= 0) {
    return;
  }

  const backups = await listBackups(retentionCount + 10);
  const successful = backups.filter((backup) => backup.status === "success");
  if (successful.length <= retentionCount) {
    return;
  }

  const toDelete = successful.slice(retentionCount);
  for (const backup of toDelete) {
    try {
      await rm(backup.filePath, { force: true });
    } catch (error) {
      console.error(
        `[backup] Failed to remove old backup file ${backup.filePath}`,
        error,
      );
      continue;
    }

    try {
      await deleteBackupRecord(backup.id);
    } catch (error) {
      console.error(
        `[backup] Failed to delete backup record ${backup.id}`,
        error,
      );
    }
  }
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
    void runScheduledBackup().catch((error) => {
      console.error("[backup] Automatic backup run failed", error);
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
    if (!config || config.backup_enabled === false) {
      scheduleNextRun(null);
      return;
    }

    const hour = toSafeHour(config.backup_hour_local);
    const timezone = config.backup_timezone ?? config.timezone ?? "UTC";
    const nextRun = computeNextRunDate(hour, timezone);
    scheduleNextRun(nextRun);
  } catch (error) {
    console.error("[backup] Failed to refresh scheduler", error);
    scheduleNextRun(null);
  } finally {
    scheduler.isScheduling = false;
  }
}

async function runScheduledBackup() {
  await runDatabaseBackup({ trigger: "automatic" });
}

async function withTrackedRun<T>(handler: () => Promise<T>) {
  const scheduler = getSchedulerState();
  if (scheduler.currentRun) {
    await scheduler.currentRun.catch(() => undefined);
  }

  const runPromise = handler()
    .then((value) => {
      return value;
    })
    .finally(() => {
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

async function updateLastStatus(params: {
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}) {
  await updateSyncConfig({
    backupLastStatus: params.status,
    backupLastStartedAt: params.startedAt ?? undefined,
    backupLastCompletedAt: params.completedAt ?? undefined,
    backupLastError: params.error ?? null,
  });
}

export async function runDatabaseBackup(options: {
  trigger: DbBackupTrigger;
  actorId?: string | null;
}) {
  return withTrackedRun(async () => {
    await ensureSchema();

    const directory = env.DB_BACKUP_DIRECTORY;
    const retentionCount = env.DB_BACKUP_RETENTION;

    const startedAt = new Date().toISOString();
    await updateLastStatus({ status: "running", startedAt, error: null });

    let backupRecord: DbBackupRecord | null = null;
    const filename = buildBackupFilename();
    const filePath = path.join(directory, filename);

    try {
      await ensureBackupDirectory(directory);
    } catch (error) {
      console.error(
        `[backup] Backup directory check failed (${directory})`,
        error,
      );
      await updateLastStatus({
        status: "failed",
        completedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Failed to ensure backup directory.",
      });
      throw error;
    }

    try {
      backupRecord = await createBackupRecord({
        filename,
        directory,
        filePath,
        trigger: options.trigger,
        startedAt,
        createdBy: options.actorId ?? null,
      });
    } catch (error) {
      console.error("[backup] Failed to record backup metadata", error);
    }

    try {
      await withJobLock("backup", async () => {
        await executeBackup(filePath);
      });

      const fileInfo = await stat(filePath).catch(() => null);
      const completedAt = new Date().toISOString();

      if (backupRecord) {
        await markBackupSuccess({
          id: backupRecord.id,
          sizeBytes: fileInfo?.size ?? null,
          completedAt,
        });
      }

      await updateLastStatus({
        status: "success",
        completedAt,
      });

      await pruneBackups(retentionCount);
      console.info(`[backup] Backup created at ${filePath}`);
    } catch (error) {
      console.error("[backup] Backup run failed", error);
      const failureMessage =
        error instanceof Error ? error.message : "Backup run failed.";
      const completedAt = new Date().toISOString();

      if (backupRecord) {
        await markBackupFailure({
          id: backupRecord.id,
          error: failureMessage,
          completedAt,
        });
      }

      await updateLastStatus({
        status: "failed",
        completedAt,
        error: failureMessage,
      });

      throw error;
    } finally {
      await refreshScheduler();
    }
  });
}

export async function restoreDatabaseBackup(params: {
  backupId: number;
  actorId?: string | null;
}) {
  await withTrackedRun(async () => {
    await ensureSchema();
    const record = await getBackupRecord(params.backupId);
    if (!record) {
      throw new Error("Backup record not found.");
    }

    await access(record.filePath, fsConstants.R_OK).catch(() => {
      throw new Error("Backup file is not accessible on disk.");
    });

    await withJobLock("restore", async () => {
      await executeRestore(record.filePath);
    });

    await markBackupRestored({ id: record.id });
    console.info(`[backup] Restore completed from ${record.filePath}`);
    await updateLastStatus({
      status: "restored",
      completedAt: new Date().toISOString(),
      error: null,
    });
    await refreshScheduler();
  });
}

export async function updateBackupSchedule(params: {
  hourLocal: number;
  timezone: string;
}) {
  await ensureSchema();

  const hour = Math.round(params.hourLocal);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    throw new Error("Backup hour must be between 0 and 23.");
  }

  const trimmedTz = params.timezone.trim();
  if (!trimmedTz) {
    throw new Error("Timezone cannot be empty.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmedTz }).format();
  } catch (_error) {
    throw new Error("Invalid timezone identifier.");
  }

  await updateSyncConfig({
    backupHourLocal: hour,
    backupTimezone: trimmedTz,
  });

  await refreshScheduler();
}

export async function getBackupRuntimeInfo(): Promise<BackupRuntimeInfo> {
  await ensureSchema();
  const [config, records] = await Promise.all([
    getSyncConfig(),
    listBackups(env.DB_BACKUP_RETENTION + 10),
  ]);

  const directory = env.DB_BACKUP_DIRECTORY;
  const retentionCount = env.DB_BACKUP_RETENTION;
  const schedule: BackupScheduleConfig & {
    nextRunAt: string | null;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  } = {
    enabled: config?.backup_enabled ?? true,
    hourLocal: toSafeHour(config?.backup_hour_local ?? DEFAULT_BACKUP_HOUR),
    timezone: config?.backup_timezone ?? config?.timezone ?? "UTC",
    nextRunAt: getSchedulerState().nextRunAt,
    lastStartedAt: config?.backup_last_started_at ?? null,
    lastCompletedAt: config?.backup_last_completed_at ?? null,
    lastStatus: config?.backup_last_status ?? null,
    lastError: config?.backup_last_error ?? null,
  };

  return {
    directory,
    retentionCount,
    schedule,
    records,
  };
}

export async function initializeBackupScheduler() {
  await refreshScheduler();
}

void initializeBackupScheduler().catch((error) => {
  console.error("[backup] Failed to initialize backup scheduler", error);
});
