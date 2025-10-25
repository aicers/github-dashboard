import { spawn } from "node:child_process";
import { type Dirent, constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { ensureSchema } from "@/lib/db";
import { query as runQuery } from "@/lib/db/client";
import {
  createBackupRecord,
  type DbBackupRecord,
  type DbBackupStatus,
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
  records: BackupRecordView[];
};

type SchedulerGlobal = typeof globalThis & {
  __githubDashboardBackupScheduler?: BackupSchedulerState;
};

export type BackupRecordView =
  | (DbBackupRecord & {
      source: "database";
      isAdditionalFile: false;
      restoreKey: string;
    })
  | {
      id: null;
      filename: string;
      directory: string;
      filePath: string;
      status: DbBackupStatus;
      trigger: DbBackupTrigger;
      startedAt: string;
      completedAt: string | null;
      sizeBytes: number | null;
      error: string | null;
      restoredAt: string | null;
      createdBy: string | null;
      source: "filesystem";
      isAdditionalFile: true;
      restoreKey: string;
    };

export type BackupRestoreKey =
  | {
      type: "database";
      id: number;
    }
  | {
      type: "filesystem";
      filePath: string;
    };

const DATABASE_RESTORE_PREFIX = "db:";
const FILESYSTEM_RESTORE_PREFIX = "fs:";

export function encodeDatabaseRestoreKey(id: number) {
  return `${DATABASE_RESTORE_PREFIX}${id}`;
}

export function encodeFilesystemRestoreKey(filePath: string) {
  const encoded = Buffer.from(filePath, "utf8").toString("base64url");
  return `${FILESYSTEM_RESTORE_PREFIX}${encoded}`;
}

export function parseBackupRestoreKey(key: string): BackupRestoreKey | null {
  if (key.startsWith(DATABASE_RESTORE_PREFIX)) {
    const numericPart = key.slice(DATABASE_RESTORE_PREFIX.length);
    const id = Number.parseInt(numericPart, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    return { type: "database", id };
  }

  if (key.startsWith(FILESYSTEM_RESTORE_PREFIX)) {
    const encoded = key.slice(FILESYSTEM_RESTORE_PREFIX.length);
    if (!encoded) {
      return null;
    }

    try {
      const filePath = Buffer.from(encoded, "base64url").toString("utf8");
      if (!filePath || filePath.includes("\u0000")) {
        return null;
      }
      return { type: "filesystem", filePath };
    } catch (_error) {
      return null;
    }
  }

  return null;
}

type BackupMetadataDetails = {
  status: DbBackupStatus | null;
  trigger: DbBackupTrigger | null;
  startedAt: string | null;
  completedAt: string | null;
  sizeBytes: number | null;
  createdBy: string | null;
  error: string | null;
};

type BackupMetadataFilePayload = {
  status?: string;
  trigger?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  sizeBytes?: number | null;
  createdBy?: string | null;
  error?: string | null;
  recordedAt?: string | null;
};

const DEFAULT_BACKUP_HOUR = 2;
const BACKUP_METADATA_SUFFIX = ".meta.json";

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

function toBackupMetadataPath(filePath: string) {
  return `${filePath}${BACKUP_METADATA_SUFFIX}`;
}

function normalizeBackupStatus(value: unknown): DbBackupStatus | null {
  if (value === "success" || value === "failed" || value === "running") {
    return value;
  }
  return null;
}

function normalizeBackupTrigger(value: unknown): DbBackupTrigger | null {
  if (value === "manual" || value === "automatic") {
    return value;
  }
  return null;
}

async function persistBackupMetadata(
  filePath: string,
  metadata: Omit<BackupMetadataFilePayload, "recordedAt">,
) {
  const metadataPath = toBackupMetadataPath(filePath);
  const payload: BackupMetadataFilePayload = {
    ...metadata,
    recordedAt: new Date().toISOString(),
  };
  try {
    await writeFile(
      metadataPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`[backup] Failed to write metadata for ${filePath}`, error);
  }
}

async function readBackupMetadata(
  filePath: string,
): Promise<BackupMetadataDetails | null> {
  const metadataPath = toBackupMetadataPath(filePath);
  try {
    const raw = await readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as BackupMetadataFilePayload;
    return {
      status: normalizeBackupStatus(parsed.status ?? null),
      trigger: normalizeBackupTrigger(parsed.trigger ?? null),
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      completedAt:
        typeof parsed.completedAt === "string" || parsed.completedAt === null
          ? (parsed.completedAt ?? null)
          : null,
      sizeBytes:
        typeof parsed.sizeBytes === "number" &&
        Number.isFinite(parsed.sizeBytes)
          ? parsed.sizeBytes
          : null,
      createdBy:
        typeof parsed.createdBy === "string" && parsed.createdBy.length > 0
          ? parsed.createdBy
          : null,
      error:
        typeof parsed.error === "string" && parsed.error.length > 0
          ? parsed.error
          : null,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(`[backup] Failed to read metadata for ${filePath}`, error);
    }
    return null;
  }
}

function toIsoDate(value: Date | null | undefined) {
  if (!value) {
    return new Date().toISOString();
  }

  const time = value.getTime();
  if (Number.isNaN(time)) {
    return new Date().toISOString();
  }

  return value.toISOString();
}

async function discoverFilesystemBackups(options: {
  directory: string;
  knownPaths: Set<string>;
}): Promise<BackupRecordView[]> {
  const { directory, knownPaths } = options;
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }

    console.error(
      `[backup] Failed to scan backup directory ${directory}`,
      error,
    );
    return [];
  }

  const records: BackupRecordView[] = [];

  for (const entry of entries) {
    if (!entry.isFile?.()) {
      continue;
    }

    const filename = entry.name;
    if (!filename.startsWith("db-backup-")) {
      continue;
    }

    if (filename.endsWith(BACKUP_METADATA_SUFFIX)) {
      continue;
    }

    const filePath = path.resolve(directory, filename);
    if (knownPaths.has(filePath)) {
      continue;
    }

    let fileInfo: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      fileInfo = await stat(filePath);
    } catch (error) {
      console.error(`[backup] Failed to stat backup file ${filePath}`, error);
      continue;
    }

    const metadata = await readBackupMetadata(filePath);
    const sizeBytesFromFile =
      typeof fileInfo.size === "number" && Number.isFinite(fileInfo.size)
        ? fileInfo.size
        : null;
    const startedAt =
      metadata?.startedAt ?? toIsoDate(fileInfo.birthtime ?? fileInfo.mtime);
    const completedAt = metadata?.completedAt ?? toIsoDate(fileInfo.mtime);
    const sizeBytes = metadata?.sizeBytes ?? sizeBytesFromFile;
    const status = metadata?.status ?? "success";
    const trigger = metadata?.trigger ?? "manual";

    records.push({
      id: null,
      filename,
      directory,
      filePath,
      status,
      trigger,
      startedAt,
      completedAt,
      sizeBytes,
      error: metadata?.error ?? null,
      restoredAt: null,
      createdBy: metadata?.createdBy ?? null,
      source: "filesystem",
      isAdditionalFile: true,
      restoreKey: encodeFilesystemRestoreKey(filePath),
    });
  }

  return records;
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

async function resetDatabaseSchema() {
  await runQuery("DROP SCHEMA IF EXISTS public CASCADE");
  await runQuery("CREATE SCHEMA public");
  await runQuery("GRANT ALL ON SCHEMA public TO CURRENT_USER");
  await runQuery("GRANT ALL ON SCHEMA public TO public");
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
      await rm(toBackupMetadataPath(backup.filePath), { force: true });
    } catch (error) {
      console.error(
        `[backup] Failed to remove metadata for ${backup.filePath}`,
        error,
      );
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
      await persistBackupMetadata(filePath, {
        status: "success",
        trigger: options.trigger,
        startedAt,
        completedAt,
        sizeBytes: fileInfo?.size ?? null,
        createdBy: options.actorId ?? null,
        error: null,
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
  backupId?: number;
  filePath?: string;
  actorId?: string | null;
}) {
  await withTrackedRun(async () => {
    await ensureSchema();
    const hasBackupId =
      typeof params.backupId === "number" && Number.isFinite(params.backupId);
    const hasFilePath =
      typeof params.filePath === "string" && params.filePath.trim().length > 0;

    if (hasBackupId === hasFilePath) {
      throw new Error("A backup identifier or file path must be provided.");
    }

    if (hasBackupId && params.backupId) {
      const record = await getBackupRecord(params.backupId);
      if (!record) {
        throw new Error("Backup record not found.");
      }

      await access(record.filePath, fsConstants.R_OK).catch(() => {
        throw new Error("Backup file is not accessible on disk.");
      });

      await withJobLock("restore", async () => {
        await resetDatabaseSchema();
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
      return;
    }

    const filePathValue = params.filePath?.trim() ?? "";
    if (!filePathValue) {
      throw new Error("Backup file path is required.");
    }
    const normalizedPath = path.resolve(filePathValue);
    await access(normalizedPath, fsConstants.R_OK).catch(() => {
      throw new Error("Backup file is not accessible on disk.");
    });

    await withJobLock("restore", async () => {
      await resetDatabaseSchema();
      await executeRestore(normalizedPath);
    });

    console.info(`[backup] Restore completed from ${normalizedPath}`);
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
  const [config, dbRecords] = await Promise.all([
    getSyncConfig(),
    listBackups(env.DB_BACKUP_RETENTION + 10),
  ]);

  const directory = env.DB_BACKUP_DIRECTORY;
  const retentionCount = env.DB_BACKUP_RETENTION;
  const dbRecordsWithMetadata = await Promise.all(
    dbRecords.map(async (record) => {
      const metadata = await readBackupMetadata(record.filePath);
      return {
        ...record,
        status: metadata?.status ?? record.status,
        trigger: metadata?.trigger ?? record.trigger,
        startedAt: metadata?.startedAt ?? record.startedAt,
        completedAt: metadata?.completedAt ?? record.completedAt,
        sizeBytes: metadata?.sizeBytes ?? record.sizeBytes,
        error: metadata?.error ?? record.error,
        createdBy: metadata?.createdBy ?? record.createdBy,
      };
    }),
  );

  const normalizedDbRecords: BackupRecordView[] = dbRecordsWithMetadata.map(
    (record) => ({
      ...record,
      source: "database" as const,
      isAdditionalFile: false,
      restoreKey: encodeDatabaseRestoreKey(record.id),
    }),
  );

  const knownPaths = new Set(
    normalizedDbRecords.map((record) => path.resolve(record.filePath)),
  );
  const filesystemRecords = await discoverFilesystemBackups({
    directory,
    knownPaths,
  });

  const combinedRecords = [...normalizedDbRecords, ...filesystemRecords].sort(
    (a, b) => {
      const aTime = new Date(a.startedAt ?? "").getTime();
      const bTime = new Date(b.startedAt ?? "").getTime();

      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      return safeBTime - safeATime;
    },
  );

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
    records: combinedRecords,
  };
}

export async function initializeBackupScheduler() {
  await refreshScheduler();
}

void initializeBackupScheduler().catch((error) => {
  console.error("[backup] Failed to initialize backup scheduler", error);
});
