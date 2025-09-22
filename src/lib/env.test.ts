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
});
