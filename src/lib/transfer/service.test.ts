import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSyncConfig,
  recordSyncLog,
  updateSyncConfig,
  updateSyncLog,
} from "@/lib/db/operations";
import { realignRepositoryMismatches } from "@/lib/github/repository-realignment";
import { withJobLock } from "@/lib/jobs/lock";
import {
  cleanupTransferSync,
  getTransferSyncRuntimeInfo,
  runTransferSync,
} from "@/lib/transfer/service";

vi.mock("@/lib/db", () => ({
  ensureSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/operations", () => ({
  getSyncConfig: vi.fn(),
  recordSyncLog: vi.fn().mockResolvedValue(123),
  updateSyncConfig: vi.fn(),
  updateSyncLog: vi.fn(),
}));

vi.mock("@/lib/github/repository-realignment", () => ({
  realignRepositoryMismatches: vi.fn(),
}));

vi.mock("@/lib/jobs/lock", () => ({
  withJobLock: vi.fn((_type: string, handler: () => Promise<unknown>) =>
    handler(),
  ),
}));

describe("runTransferSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as { __githubDashboardTransferScheduler?: unknown }
    ).__githubDashboardTransferScheduler = undefined;
    vi.mocked(getSyncConfig).mockResolvedValue({
      transfer_sync_hour_local: 4,
      transfer_sync_minute_local: 0,
      transfer_sync_timezone: "UTC",
      timezone: "UTC",
      transfer_sync_last_started_at: null,
      transfer_sync_last_completed_at: null,
      transfer_sync_last_status: "idle",
      transfer_sync_last_error: null,
    });
    vi.mocked(realignRepositoryMismatches).mockResolvedValue({
      candidates: 1,
      updated: 1,
      dryRun: false,
    });
    vi.mocked(updateSyncConfig).mockResolvedValue(undefined);
    vi.mocked(updateSyncLog).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("records waiting, running, and success states in order", async () => {
    await runTransferSync({ trigger: "manual", actorId: "user-1" });

    const calls = vi
      .mocked(updateSyncConfig)
      .mock.calls.map(([payload]) => payload);
    expect(calls[0]).toMatchObject({
      transferSyncLastStartedAt: null,
      transferSyncLastCompletedAt: null,
      transferSyncLastStatus: "waiting",
      transferSyncLastError: null,
    });

    const runningCall = calls.find(
      (call) => call.transferSyncLastStatus === "running",
    );
    expect(runningCall?.transferSyncLastStartedAt).toEqual(
      expect.stringMatching(/T/),
    );

    const successCall = calls.find(
      (call) => call.transferSyncLastStatus === "success",
    );
    expect(successCall?.transferSyncLastCompletedAt).toEqual(
      expect.stringMatching(/T/),
    );

    expect(vi.mocked(recordSyncLog)).toHaveBeenCalledWith(
      "transfer-sync",
      "running",
      "Manual transfer sync started by user-1.",
    );
    expect(vi.mocked(realignRepositoryMismatches)).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "manual" }),
    );
    expect(vi.mocked(withJobLock)).toHaveBeenCalled();

    const runtime = await getTransferSyncRuntimeInfo();
    expect(runtime.isWaiting).toBe(false);
    expect(runtime.isRunning).toBe(false);
  });

  it("fails when waiting too long for other jobs", async () => {
    const waitTimeoutMs = 20;
    vi.mocked(withJobLock).mockImplementation(async (_type, handler) => {
      await new Promise((resolve) => setTimeout(resolve, waitTimeoutMs * 3));
      return handler();
    });

    const runPromise = runTransferSync({
      trigger: "manual",
      actorId: "user-1",
      waitTimeoutMs,
    });

    await expect(runPromise).rejects.toThrow(/timed out/i);

    const calls = vi
      .mocked(updateSyncConfig)
      .mock.calls.map(([payload]) => payload);
    const failedCall = calls.find(
      (call) => call.transferSyncLastStatus === "failed",
    );
    expect(failedCall?.transferSyncLastError).toContain("timed out");

    const runtime = await getTransferSyncRuntimeInfo();
    expect(runtime.isWaiting).toBe(false);
  });

  it("cleans up stuck transfer sync and clears runtime flags", async () => {
    vi.mocked(getSyncConfig).mockResolvedValueOnce({
      transfer_sync_hour_local: 4,
      transfer_sync_minute_local: 0,
      transfer_sync_timezone: "UTC",
      timezone: "UTC",
      transfer_sync_last_started_at: "2024-04-01T00:00:00.000Z",
      transfer_sync_last_completed_at: null,
      transfer_sync_last_status: "running",
      transfer_sync_last_error: null,
    });

    const scheduler = (
      globalThis as {
        __githubDashboardTransferScheduler?: {
          isWaiting: boolean;
          waitStartedAt: number | null;
          currentRun: Promise<void> | null;
        };
      }
    ).__githubDashboardTransferScheduler;
    if (scheduler) {
      scheduler.isWaiting = true;
      scheduler.waitStartedAt = Date.now();
      scheduler.currentRun = Promise.resolve();
    }

    await cleanupTransferSync({ actorId: "admin-user" });
    const runtime = await getTransferSyncRuntimeInfo();
    expect(runtime.isWaiting).toBe(false);
    expect(runtime.isRunning).toBe(false);

    const failedCall = vi
      .mocked(updateSyncConfig)
      .mock.calls.map(([payload]) => payload)
      .find((call) => call.transferSyncLastStatus === "failed");
    expect(failedCall?.transferSyncLastError).toContain("marked as failed");
  });
});
