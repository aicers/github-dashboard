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

const accessMock = vi.fn();
const mkdirMock = vi.fn();
const rmMock = vi.fn();
const statMock = vi.fn();

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
  rm: rmMock,
  stat: statMock,
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

  accessMock.mockReset();
  mkdirMock.mockReset();
  rmMock.mockReset();
  statMock.mockReset();
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
      { id: 1, status: "success", filePath: "/tmp/1.dump" },
      { id: 2, status: "success", filePath: "/tmp/2.dump" },
      { id: 3, status: "failed", filePath: "/tmp/3.dump" },
      { id: 4, status: "success", filePath: "/tmp/4.dump" },
    ]);
    rmMock.mockResolvedValue(undefined);
    deleteBackupRecordMock.mockResolvedValue(undefined);

    const { runDatabaseBackup, getBackupRuntimeInfo } = await loadService();

    await runDatabaseBackup({
      trigger: "manual",
      actorId: "user-1",
    });

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
    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith("/tmp/4.dump", { force: true });
    expect(deleteBackupRecordMock).toHaveBeenCalledWith(4);

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
    expect(markBackupRestoredMock).toHaveBeenCalledWith({ id: 7 });
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
