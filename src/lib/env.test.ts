import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("env configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("defaults sync interval to 60 minutes when unset", async () => {
    delete process.env.SYNC_INTERVAL_MINUTES;
    const { env } = await import("./env");
    expect(env.SYNC_INTERVAL_MINUTES).toBe(60);
  });

  test("parses sync interval minutes from environment", async () => {
    process.env.SYNC_INTERVAL_MINUTES = "45";
    const { env } = await import("./env");
    expect(env.SYNC_INTERVAL_MINUTES).toBe(45);
  });

  test("resolves backup directory with default fallback", async () => {
    delete process.env.DB_BACKUP_DIRECTORY;
    const { env } = await import("./env");
    expect(env.DB_BACKUP_DIRECTORY.endsWith("backups")).toBe(true);
  });

  test("resolves backup directory from relative path", async () => {
    process.env.DB_BACKUP_DIRECTORY = "data/backups";
    const { env } = await import("./env");
    expect(env.DB_BACKUP_DIRECTORY.endsWith(path.join("data", "backups"))).toBe(
      true,
    );
  });

  test("parses backup retention with bounds", async () => {
    process.env.DB_BACKUP_RETENTION = "5";
    const { env } = await import("./env");
    expect(env.DB_BACKUP_RETENTION).toBe(5);
  });

  test("throws when backup retention exceeds 10", async () => {
    process.env.DB_BACKUP_RETENTION = "12";
    await expect(import("./env")).rejects.toThrow(
      /DB_BACKUP_RETENTION cannot exceed 10/,
    );
  });
});
