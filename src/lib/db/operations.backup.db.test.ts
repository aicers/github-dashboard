// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import {
  createBackupRecord,
  deleteBackupRecord,
  getBackupRecord,
  listBackups,
  markBackupFailure,
  markBackupRestored,
  markBackupSuccess,
} from "@/lib/db/operations";

async function resetDatabase() {
  await ensureSchema();
  await query("TRUNCATE TABLE db_backups RESTART IDENTITY CASCADE");
}

describe("db backup operations", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates records and marks successful completion with size metadata", async () => {
    const startedAt = "2024-01-01T10:00:00.000Z";
    const created = await createBackupRecord({
      filename: "db-backup-20240101.dump",
      directory: "/var/backups",
      filePath: "/var/backups/db-backup-20240101.dump",
      trigger: "manual",
      startedAt,
      createdBy: "admin-user",
    });

    expect(created).not.toBeNull();
    if (!created) {
      throw new Error("Failed to create backup record");
    }

    expect(created.status).toBe("running");
    expect(created.startedAt).toBe(startedAt);
    expect(created.completedAt).toBeNull();
    expect(created.createdBy).toBe("admin-user");

    const completedAt = "2024-01-01T10:05:00.000Z";
    const success = await markBackupSuccess({
      id: created.id,
      sizeBytes: 1_572_864,
      completedAt,
    });

    expect(success?.status).toBe("success");
    expect(success?.completedAt).toBe(completedAt);
    expect(success?.sizeBytes).toBe(1_572_864);
    expect(success?.error).toBeNull();

    const fetched = await getBackupRecord(created.id);
    expect(fetched?.status).toBe("success");
    expect(fetched?.sizeBytes).toBe(1_572_864);
  });

  it("records failure details and supports very large size values", async () => {
    const record = await createBackupRecord({
      filename: "db-backup-large.dump",
      directory: "/var/backups",
      filePath: "/var/backups/db-backup-large.dump",
      trigger: "automatic",
    });

    expect(record).not.toBeNull();
    if (!record) {
      throw new Error("Failed to create backup record");
    }

    await query("UPDATE db_backups SET size_bytes = $1 WHERE id = $2", [
      "9007199254740991",
      record.id,
    ]);

    const largeSize = await getBackupRecord(record.id);
    expect(largeSize?.sizeBytes).toBe(9_007_199_254_740_991);

    const failure = await markBackupFailure({
      id: record.id,
      error: "pg_dump crashed",
      completedAt: "2024-01-01T11:00:00.000Z",
    });

    expect(failure?.status).toBe("failed");
    expect(failure?.error).toBe("pg_dump crashed");

    await markBackupRestored({
      id: record.id,
      restoredAt: "2024-01-01T12:00:00.000Z",
    });

    const restored = await getBackupRecord(record.id);
    expect(restored?.restoredAt).toBe("2024-01-01T12:00:00.000Z");
  });

  it("lists backups in reverse chronological order and deletes rows", async () => {
    const first = await createBackupRecord({
      filename: "db-1.dump",
      directory: "/var/backups",
      filePath: "/var/backups/db-1.dump",
      trigger: "manual",
      startedAt: "2024-01-01T08:00:00.000Z",
    });
    const second = await createBackupRecord({
      filename: "db-2.dump",
      directory: "/var/backups",
      filePath: "/var/backups/db-2.dump",
      trigger: "manual",
      startedAt: "2024-01-01T09:00:00.000Z",
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      throw new Error("Failed to create backup records");
    }

    await markBackupSuccess({
      id: second.id,
      sizeBytes: 512,
      completedAt: "2024-01-01T09:05:00.000Z",
    });

    const backups = await listBackups(10);
    expect(backups.map((backup) => backup.filename)).toEqual([
      "db-2.dump",
      "db-1.dump",
    ]);

    await deleteBackupRecord(first.id);

    const deleted = await getBackupRecord(first.id);
    expect(deleted).toBeNull();
  });
});
