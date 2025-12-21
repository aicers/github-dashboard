// @vitest-environment node

import { EventEmitter } from "node:events";
import path from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureSchemaMock = vi.fn();
const createBackupRecordMock = vi.fn();
const deleteBackupRecordMock = vi.fn();
const getBackupRecordMock = vi.fn();
const getSyncConfigMock = vi.fn();
const listBackupsMock = vi.fn();
const markBackupFailureMock = vi.fn();
const markBackupRestoredMock = vi.fn();
const markBackupSuccessMock = vi.fn();
const updateSyncConfigMock = vi.fn();
const withJobLockMock = vi.fn();
const queryMock = vi.fn();

const accessMock = vi.fn();
const mkdirMock = vi.fn();
const readdirMock = vi.fn();
const readFileMock = vi.fn();
const rmMock = vi.fn();
const statMock = vi.fn();
const writeFileMock = vi.fn();

const spawnMock = vi.fn();

const envValues = {
  DATABASE_URL: "postgres://localhost/test",
  DB_BACKUP_DIRECTORY: path.resolve(process.cwd(), ".tmp-backups"),
  DB_BACKUP_RETENTION: 3,
};

type ChildProcessStub = EventEmitter & {
  kill: Mock;
};

function createChildProcessStub() {
  const emitter = new EventEmitter() as ChildProcessStub;
  emitter.kill = vi.fn();
  return emitter;
}

const childProcessStubs: ChildProcessStub[] = [];

vi.mock("@/lib/db", () => ({
  ensureSchema: ensureSchemaMock,
}));

vi.mock("@/lib/db/operations", () => ({
  createBackupRecord: createBackupRecordMock,
  deleteBackupRecord: deleteBackupRecordMock,
  getBackupRecord: getBackupRecordMock,
  getSyncConfig: getSyncConfigMock,
  listBackups: listBackupsMock,
  markBackupFailure: markBackupFailureMock,
  markBackupRestored: markBackupRestoredMock,
  markBackupSuccess: markBackupSuccessMock,
  updateSyncConfig: updateSyncConfigMock,
}));

vi.mock("@/lib/db/client", () => ({
  query: queryMock,
}));

vi.mock("@/lib/env", () => ({
  env: envValues,
}));

vi.mock("@/lib/jobs/lock", () => ({
  withJobLock: withJobLockMock.mockImplementation(
    async (_name: string, handler: () => Promise<unknown>) => handler(),
  ),
}));

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  mkdir: mkdirMock,
  readdir: readdirMock,
  readFile: readFileMock,
  rm: rmMock,
  stat: statMock,
  writeFile: writeFileMock,
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

async function loadService() {
  const module = await import("./service");
  return module;
}

function resetScheduler() {
  const globalWithScheduler = globalThis as {
    __githubDashboardBackupScheduler?: unknown;
  };
  delete globalWithScheduler.__githubDashboardBackupScheduler;
}

beforeEach(() => {
  vi.resetModules();
  resetScheduler();

  ensureSchemaMock.mockReset();
  createBackupRecordMock.mockReset();
  deleteBackupRecordMock.mockReset();
  getBackupRecordMock.mockReset();
  getSyncConfigMock.mockReset();
  listBackupsMock.mockReset();
  markBackupFailureMock.mockReset();
  markBackupRestoredMock.mockReset();
  markBackupSuccessMock.mockReset();
  updateSyncConfigMock.mockReset();
  withJobLockMock.mockReset();
  withJobLockMock.mockImplementation(
    async (_name: string, handler: () => Promise<unknown>) => await handler(),
  );
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });

  accessMock.mockReset();
  mkdirMock.mockReset();
  readdirMock.mockReset();
  readFileMock.mockReset();
  rmMock.mockReset();
  statMock.mockReset();
  writeFileMock.mockReset();
  spawnMock.mockReset();
  childProcessStubs.length = 0;
  spawnMock.mockImplementation(() => {
    const stub = createChildProcessStub();
    childProcessStubs.push(stub);
    queueMicrotask(() => {
      stub.emit("close", 0);
    });
    return stub as unknown as NodeJS.Process;
  });

  envValues.DATABASE_URL = "postgres://localhost/test";
  envValues.DB_BACKUP_DIRECTORY = path.resolve(process.cwd(), ".tmp-backups");
  envValues.DB_BACKUP_RETENTION = 3;

  readdirMock.mockResolvedValue([]);
  readFileMock.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  writeFileMock.mockResolvedValue(undefined);
  vi.useRealTimers();
  vi.setSystemTime(new Date("2024-01-05T10:00:00.000Z"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("runDatabaseBackup", () => {
  it("records successful backup metadata and prunes old backups", async () => {
    getSyncConfigMock.mockResolvedValue({
      backup_enabled: true,
      backup_hour_local: 2,
      backup_timezone: "UTC",
      timezone: "UTC",
    });
    envValues.DB_BACKUP_RETENTION = 2;
    ensureSchemaMock.mockResolvedValue(undefined);
    accessMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    accessMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    statMock.mockResolvedValue({ size: 2048 });
    createBackupRecordMock.mockResolvedValue({
      id: 42,
      status: "running",
    });
    listBackupsMock.mockResolvedValue([
      {
        id: 1,
        filename: "db-backup-1.dump",
        directory: "/tmp",
        filePath: "/tmp/1.dump",
        status: "success",
        trigger: "manual",
        startedAt: "2024-01-04T00:00:00.000Z",
        completedAt: "2024-01-04T00:05:00.000Z",
        sizeBytes: 1024,
        error: null,
        restoredAt: null,
        createdBy: null,
      },
      {
        id: 2,
        filename: "db-backup-2.dump",
        directory: "/tmp",
        filePath: "/tmp/2.dump",
        status: "success",
        trigger: "manual",
        startedAt: "2024-01-03T00:00:00.000Z",
        completedAt: "2024-01-03T00:05:00.000Z",
        sizeBytes: 1024,
        error: null,
        restoredAt: null,
        createdBy: null,
      },
      {
        id: 3,
        filename: "db-backup-3.dump",
        directory: "/tmp",
        filePath: "/tmp/3.dump",
        status: "failed",
        trigger: "manual",
        startedAt: "2024-01-02T00:00:00.000Z",
        completedAt: null,
        sizeBytes: null,
        error: "failed",
        restoredAt: null,
        createdBy: null,
      },
      {
        id: 4,
        filename: "db-backup-4.dump",
        directory: "/tmp",
        filePath: "/tmp/4.dump",
        status: "success",
        trigger: "manual",
        startedAt: "2024-01-01T00:00:00.000Z",
        completedAt: "2024-01-01T00:05:00.000Z",
        sizeBytes: 1024,
        error: null,
        restoredAt: null,
        createdBy: null,
      },
    ]);
    rmMock.mockResolvedValue(undefined);
    deleteBackupRecordMock.mockResolvedValue(undefined);

    const { runDatabaseBackup, getBackupRuntimeInfo } = await loadService();

    await runDatabaseBackup({
      trigger: "manual",
      actorId: "user-1",
    });

    expect(updateSyncConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backupLastStatus: "waiting",
        backupLastCompletedAt: null,
      }),
    );
    expect(ensureSchemaMock).toHaveBeenCalled();
    expect(createBackupRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "manual",
        createdBy: "user-1",
      }),
    );
    expect(withJobLockMock).toHaveBeenCalledWith(
      "backup",
      expect.any(Function),
    );
    expect(markBackupSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        sizeBytes: 2048,
      }),
    );
    expect(updateSyncConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backupLastStatus: "success",
      }),
    );
    expect(listBackupsMock).toHaveBeenCalledWith(
      envValues.DB_BACKUP_RETENTION + 10,
    );
    expect(rmMock).toHaveBeenCalledTimes(2);
    expect(rmMock).toHaveBeenNthCalledWith(1, "/tmp/4.dump", {
      force: true,
    });
    expect(rmMock).toHaveBeenNthCalledWith(2, "/tmp/4.dump.meta.json", {
      force: true,
    });
    expect(deleteBackupRecordMock).toHaveBeenCalledWith(4);

    const metadataCall = writeFileMock.mock.calls.find(([filePath]) =>
      filePath.toString().endsWith(".meta.json"),
    );
    expect(metadataCall).toBeTruthy();
    if (metadataCall) {
      const [metadataPath, raw, encoding] = metadataCall;
      expect(metadataPath).toContain(envValues.DB_BACKUP_DIRECTORY);
      expect(encoding).toBe("utf8");
      const metadata = JSON.parse(raw as string);
      expect(metadata.status).toBe("success");
      expect(metadata.trigger).toBe("manual");
      expect(typeof metadata.startedAt).toBe("string");
      expect(metadata.completedAt).toBeDefined();
    }

    const info = await getBackupRuntimeInfo();
    expect(info.directory).toBe(envValues.DB_BACKUP_DIRECTORY);
  });

  it("marks backup failure and rethrows error when execution fails", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    accessMock.mockResolvedValue(undefined);
    statMock.mockResolvedValue({ size: 0 });
    createBackupRecordMock.mockResolvedValue({ id: 15 });
    listBackupsMock.mockResolvedValue([]);

    spawnMock.mockImplementationOnce(() => {
      const stub = createChildProcessStub();
      childProcessStubs.push(stub);
      queueMicrotask(() => {
        stub.emit("error", new Error("pg_dump crashed"));
      });
      return stub as unknown as NodeJS.Process;
    });

    const { runDatabaseBackup } = await loadService();

    const runPromise = runDatabaseBackup({ trigger: "automatic" });

    await expect(runPromise).rejects.toThrow("pg_dump crashed");
    expect(markBackupFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 15,
        error: "pg_dump crashed",
      }),
    );
    expect(updateSyncConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backupLastStatus: "failed",
        backupLastError: "pg_dump crashed",
      }),
    );
  });

  it("skips pruning when retention count is disabled", async () => {
    envValues.DB_BACKUP_RETENTION = 0;
    ensureSchemaMock.mockResolvedValue(undefined);
    accessMock.mockResolvedValue(undefined);
    statMock.mockResolvedValue({ size: 256 });
    createBackupRecordMock.mockResolvedValue({ id: 33 });
    listBackupsMock.mockResolvedValue([]);

    const { runDatabaseBackup } = await loadService();
    await runDatabaseBackup({ trigger: "manual" });

    expect(listBackupsMock).not.toHaveBeenCalled();
    expect(deleteBackupRecordMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent backup requests via scheduler state", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    accessMock.mockResolvedValue(undefined);
    listBackupsMock.mockResolvedValue([]);
    statMock.mockResolvedValue({ size: 512 });
    createBackupRecordMock.mockResolvedValue({ id: 20 });

    let activeLocks = 0;
    let peakLocks = 0;
    withJobLockMock.mockImplementation(async (_name: string, handler) => {
      activeLocks += 1;
      peakLocks = Math.max(peakLocks, activeLocks);
      try {
        return await handler();
      } finally {
        activeLocks -= 1;
      }
    });

    const { runDatabaseBackup } = await loadService();
    await Promise.all([
      runDatabaseBackup({ trigger: "manual" }),
      runDatabaseBackup({ trigger: "manual" }),
    ]);

    expect(peakLocks).toBe(1);
    expect(withJobLockMock).toHaveBeenCalledTimes(2);
  });
});

describe("getBackupRuntimeInfo", () => {
  it("includes filesystem backups that are not recorded in the database", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    getSyncConfigMock.mockResolvedValue({
      backup_enabled: true,
      backup_hour_local: 2,
      backup_timezone: "UTC",
      timezone: "UTC",
    });

    const trackedFile = path.join(
      envValues.DB_BACKUP_DIRECTORY,
      "db-backup-20240105.dump",
    );
    const untrackedFile = path.join(
      envValues.DB_BACKUP_DIRECTORY,
      "db-backup-20240106.dump",
    );

    listBackupsMock.mockResolvedValue([
      {
        id: 10,
        filename: "db-backup-20240105.dump",
        directory: envValues.DB_BACKUP_DIRECTORY,
        filePath: trackedFile,
        status: "running",
        trigger: "automatic",
        startedAt: "2024-01-05T00:00:00.000Z",
        completedAt: "2024-01-05T00:02:00.000Z",
        sizeBytes: 2_048,
        error: null,
        restoredAt: null,
        createdBy: "admin",
      },
    ]);

    readdirMock.mockResolvedValue([
      {
        name: "db-backup-20240106.dump",
        isFile: () => true,
      },
      {
        name: "db-backup-20240106.dump.meta.json",
        isFile: () => true,
      },
    ]);
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("db-backup-20240106.dump.meta.json")) {
        return `${JSON.stringify({
          status: "failed",
          trigger: "automatic",
          startedAt: "2024-01-06T00:00:00.000Z",
          completedAt: "2024-01-06T00:03:00.000Z",
          sizeBytes: 4_096,
          error: "Checksum mismatch",
          createdBy: "bot",
        })}\n`;
      }
      if (filePath.endsWith("db-backup-20240105.dump.meta.json")) {
        return `${JSON.stringify({
          status: "success",
          trigger: "automatic",
          startedAt: "2024-01-05T00:00:00.000Z",
          completedAt: "2024-01-05T00:02:00.000Z",
          sizeBytes: 2_560,
        })}\n`;
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    statMock.mockImplementation(async (filePath: string) => {
      if (filePath === untrackedFile) {
        return {
          size: 4_096,
          birthtime: new Date("2024-01-06T00:00:00.000Z"),
          mtime: new Date("2024-01-06T00:03:00.000Z"),
        };
      }

      return {
        size: 2_048,
        birthtime: new Date("2024-01-05T00:00:00.000Z"),
        mtime: new Date("2024-01-05T00:02:00.000Z"),
      };
    });

    const { getBackupRuntimeInfo } = await loadService();
    const info = await getBackupRuntimeInfo();

    expect(info.records).toHaveLength(2);
    expect(info.records[0]).toMatchObject({
      filename: "db-backup-20240106.dump",
      filePath: untrackedFile,
      isAdditionalFile: true,
      source: "filesystem",
      status: "failed",
      trigger: "automatic",
      sizeBytes: 4_096,
      error: "Checksum mismatch",
      createdBy: "bot",
      startedAt: "2024-01-06T00:00:00.000Z",
      completedAt: "2024-01-06T00:03:00.000Z",
    });
    expect(info.records[0].restoreKey.startsWith("fs:")).toBe(true);
    expect(info.records[1]).toMatchObject({
      id: 10,
      filename: "db-backup-20240105.dump",
      isAdditionalFile: false,
      source: "database",
      restoreKey: "db:10",
    });
    expect(info.records[1].status).toBe("success");
    expect(info.records[1].sizeBytes).toBe(2_560);
  });
});

describe("restoreDatabaseBackup", () => {
  it("ensures backup file accessibility and marks restore completion", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    accessMock.mockResolvedValue(undefined);
    getBackupRecordMock.mockResolvedValue({
      id: 7,
      filePath: "/tmp/backup.dump",
    });

    const { restoreDatabaseBackup } = await loadService();

    await restoreDatabaseBackup({ backupId: 7, actorId: "admin" });

    expect(getBackupRecordMock).toHaveBeenCalledWith(7);
    expect(withJobLockMock).toHaveBeenCalledWith(
      "restore",
      expect.any(Function),
    );
    expect(queryMock).toHaveBeenCalledWith(
      "DROP SCHEMA IF EXISTS public CASCADE",
    );
    expect(queryMock).toHaveBeenCalledWith("CREATE SCHEMA public");
    expect(queryMock).toHaveBeenCalledWith(
      "GRANT ALL ON SCHEMA public TO CURRENT_USER",
    );
    expect(queryMock).toHaveBeenCalledWith(
      "GRANT ALL ON SCHEMA public TO public",
    );
    expect(markBackupRestoredMock).toHaveBeenCalledWith({ id: 7 });
    expect(updateSyncConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backupLastStatus: "restored",
      }),
    );
  });

  it("restores backups that exist only on the filesystem", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    accessMock.mockResolvedValue(undefined);

    const { restoreDatabaseBackup } = await loadService();

    await restoreDatabaseBackup({
      filePath: path.join(
        envValues.DB_BACKUP_DIRECTORY,
        "db-backup-extra.dump",
      ),
    });

    expect(getBackupRecordMock).not.toHaveBeenCalled();
    expect(withJobLockMock).toHaveBeenCalledWith(
      "restore",
      expect.any(Function),
    );
    expect(queryMock).toHaveBeenCalledWith(
      "DROP SCHEMA IF EXISTS public CASCADE",
    );
    expect(queryMock).toHaveBeenCalledWith("CREATE SCHEMA public");
    expect(queryMock).toHaveBeenCalledWith(
      "GRANT ALL ON SCHEMA public TO CURRENT_USER",
    );
    expect(queryMock).toHaveBeenCalledWith(
      "GRANT ALL ON SCHEMA public TO public",
    );
    expect(markBackupRestoredMock).not.toHaveBeenCalled();
    expect(updateSyncConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backupLastStatus: "restored",
      }),
    );
  });
});

describe("refreshScheduler", () => {
  it("clears scheduled timer when backups disabled", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    listBackupsMock.mockResolvedValue([]);
    getSyncConfigMock.mockResolvedValue({
      backup_enabled: false,
      backup_hour_local: 2,
      backup_timezone: "UTC",
      timezone: "UTC",
    });

    const { initializeBackupScheduler, getBackupRuntimeInfo } =
      await loadService();
    await initializeBackupScheduler();
    const info = await getBackupRuntimeInfo();
    expect(info.schedule.nextRunAt).toBeNull();
    expect(info.schedule.enabled).toBe(false);
  });

  it("calculates next run respecting provided timezone", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);
    getSyncConfigMock.mockResolvedValue({
      backup_enabled: true,
      backup_hour_local: 23,
      backup_timezone: "Asia/Seoul",
      timezone: "UTC",
    });

    vi.setSystemTime(new Date("2024-03-30T14:00:00.000Z")); // March 31 DST change in Asia/Seoul

    const { initializeBackupScheduler } = await loadService();
    await initializeBackupScheduler();

    const globalWithScheduler = globalThis as {
      __githubDashboardBackupScheduler?: { nextRunAt: string | null };
    };

    const nextRunAt =
      globalWithScheduler.__githubDashboardBackupScheduler?.nextRunAt;
    expect(nextRunAt).not.toBeNull();
    if (nextRunAt) {
      const nextRun = new Date(nextRunAt);
      const now = new Date();
      expect(nextRun.getTime()).toBeGreaterThan(now.getTime());
      expect(nextRun.getTime()).toBeLessThanOrEqual(
        now.getTime() + 24 * 60 * 60 * 1000,
      );
    }
  });
});

describe("updateBackupSchedule", () => {
  it("validates hour bounds and trims timezone input", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);

    const { updateBackupSchedule } = await loadService();

    await updateBackupSchedule({ hourLocal: 10.6, timezone: "  UTC " });

    expect(updateSyncConfigMock).toHaveBeenCalledWith({
      backupHourLocal: 11,
      backupTimezone: "UTC",
    });
  });

  it("rejects empty timezone input", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);

    const { updateBackupSchedule } = await loadService();

    await expect(
      updateBackupSchedule({ hourLocal: 8, timezone: "   " }),
    ).rejects.toThrow("Timezone cannot be empty.");
  });

  it("rejects invalid timezone identifier", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);

    const { updateBackupSchedule } = await loadService();

    await expect(
      updateBackupSchedule({ hourLocal: 12, timezone: "Mars/Olympus" }),
    ).rejects.toThrow("Invalid timezone identifier.");
  });

  it("rejects out-of-range hour input", async () => {
    ensureSchemaMock.mockResolvedValue(undefined);

    const { updateBackupSchedule } = await loadService();

    await expect(
      updateBackupSchedule({ hourLocal: -1, timezone: "UTC" }),
    ).rejects.toThrow("Backup hour must be between 0 and 23.");

    await expect(
      updateBackupSchedule({ hourLocal: 24, timezone: "UTC" }),
    ).rejects.toThrow("Backup hour must be between 0 and 23.");
  });
});
