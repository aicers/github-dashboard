import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("env configuration", () => {
  const originalEnv = { ...process.env };

  function setProductionAuthEnv() {
    vi.stubEnv("NODE_ENV", "production");
    process.env.GITHUB_ALLOWED_ORG = "acme";
    process.env.GITHUB_OAUTH_CLIENT_ID = "client-id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.SESSION_SECRET = "a".repeat(32);
  }

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  test("defaults saved filter limit to 30 when unset", async () => {
    delete process.env.ACTIVITY_SAVED_FILTER_LIMIT;
    const { env } = await import("./env");
    expect(env.ACTIVITY_SAVED_FILTER_LIMIT).toBe(30);
  });

  test("parses saved filter limit from environment", async () => {
    process.env.ACTIVITY_SAVED_FILTER_LIMIT = "45";
    const { env } = await import("./env");
    expect(env.ACTIVITY_SAVED_FILTER_LIMIT).toBe(45);
  });

  test.each([
    "GITHUB_ALLOWED_ORG",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "SESSION_SECRET",
  ])("throws in production when %s is missing", async (missingKey) => {
    setProductionAuthEnv();
    delete process.env[missingKey];

    const { assertProductionAuthEnv } = await import("./env");

    expect(() => assertProductionAuthEnv()).toThrow(
      new RegExp(`\\b${missingKey}\\b`),
    );
  });

  test("does not require production auth settings outside production", async () => {
    delete process.env.GITHUB_ALLOWED_ORG;
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "test");

    const { assertProductionAuthEnv } = await import("./env");

    expect(() => assertProductionAuthEnv()).not.toThrow();
  });
});
