import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncStreamEvent } from "@/lib/sync/events";

type SyncConfigRow = {
  org_name: string | null;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number | null;
  timezone: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  last_successful_sync_at: string | null;
};

const ensureSchemaMock = vi.fn(async () => {});
const getSyncConfigMock = vi.fn(
  async (_resource?: string): Promise<SyncConfigRow | null> => ({
    org_name: "acme",
    auto_sync_enabled: false,
    sync_interval_minutes: 60,
    timezone: "UTC",
    last_sync_started_at: null,
    last_sync_completed_at: null,
    last_successful_sync_at: "2024-04-01T00:00:00.000Z",
  }),
);
const updateSyncConfigMock = vi.fn(async (_params: Record<string, unknown>) => {
  /* no-op */
});
const getSyncStateMock = vi.fn(
  async (
    _resource: string,
  ): Promise<{ last_item_timestamp: string | null } | null> => null,
);
const resetDataMock = vi.fn(async () => {});
const getLatestSyncLogsMock = vi.fn(async () => []);
const getLatestSyncRunsMock = vi.fn(async () => []);
const createSyncRunMock = vi.fn(
  async (_params: {
    runType: string;
    strategy: string;
    since: string | null;
    until: string | null;
    startedAt: string;
  }) => 1,
);
const updateSyncRunStatusMock = vi.fn(
  async (
    _runId: number,
    _status: "running" | "success" | "failed",
    _completedAt: string | null,
  ) => {},
);
const getDataFreshnessMock = vi.fn(async () => null);
const getDashboardStatsMock = vi.fn(async () => ({ repositories: 0 }));
const cleanupRunningSyncRunsMock = vi.fn<
  () => Promise<{
    runs: Array<{
      id: number;
      run_type: string;
      strategy: string;
      since: string | null;
      until: string | null;
      status: string;
      started_at: string | Date | null;
      completed_at: string | Date | null;
    }>;
    logs: Array<{
      id: number;
      run_id: number | null;
      resource: string;
      status: string;
      message: string | null;
      started_at: string | Date | null;
      finished_at: string | Date | null;
    }>;
  }>
>(async () => ({ runs: [], logs: [] }));
const emitSyncEventMock = vi.fn<(event: SyncStreamEvent) => void>();
const recordSyncLogMock = vi.fn(async () => 42);
const updateSyncLogMock = vi.fn(async () => undefined);

type RunCollectionResult = {
  repositoriesProcessed: number;
  counts: {
    issues: number;
    discussions: number;
    pullRequests: number;
    reviews: number;
    comments: number;
  };
  timestamps: {
    repositories: string | null;
    issues: string | null;
    discussions: string | null;
    pullRequests: string | null;
    reviews: string | null;
    comments: string | null;
  };
};

const runCollectionMock = vi.fn(
  async (): Promise<RunCollectionResult> => ({
    repositoriesProcessed: 0,
    counts: {
      issues: 0,
      discussions: 0,
      pullRequests: 0,
      reviews: 0,
      comments: 0,
    },
    timestamps: {
      repositories: null,
      issues: null,
      discussions: null,
      pullRequests: null,
      reviews: null,
      comments: null,
    },
  }),
);

const collectPullRequestLinksMock = vi.fn(async () => ({
  repositoriesProcessed: 0,
  pullRequestCount: 0,
  latestPullRequestUpdated: null as string | null,
}));
const activityCacheRefreshResultMock = {
  filterOptions: {
    cacheKey: "activity-filter-options",
    generatedAt: "2024-04-01T00:00:00.000Z",
    syncRunId: 1,
    itemCount: 0,
    metadata: {},
  },
  issueLinks: {
    cacheKey: "activity-issue-links",
    generatedAt: "2024-04-01T00:00:00.000Z",
    syncRunId: 1,
    itemCount: 0,
    metadata: { linkCount: 0 },
  },
  pullRequestLinks: {
    cacheKey: "activity-pull-request-links",
    generatedAt: "2024-04-01T00:00:00.000Z",
    syncRunId: 1,
    itemCount: 0,
    metadata: { linkCount: 0 },
  },
};
const refreshActivityCachesMock = vi.fn(
  async () => activityCacheRefreshResultMock,
);
const ensureActivityCachesMock = vi.fn(async () => null);
const ensureIssueStatusAutomationMock = vi.fn(async () => {});
const refreshActivityItemsSnapshotMock = vi.fn(async () => {});
const refreshAttentionReactionsMock = vi.fn(async () => {});

vi.mock("@/lib/db", () => ({
  ensureSchema: ensureSchemaMock,
}));

vi.mock("@/lib/db/operations", () => ({
  getSyncConfig: getSyncConfigMock,
  updateSyncConfig: updateSyncConfigMock,
  getSyncState: getSyncStateMock,
  resetData: resetDataMock,
  getLatestSyncLogs: getLatestSyncLogsMock,
  getLatestSyncRuns: getLatestSyncRunsMock,
  createSyncRun: createSyncRunMock,
  updateSyncRunStatus: updateSyncRunStatusMock,
  getDataFreshness: getDataFreshnessMock,
  getDashboardStats: getDashboardStatsMock,
  cleanupRunningSyncRuns: cleanupRunningSyncRunsMock,
  recordSyncLog: recordSyncLogMock,
  updateSyncLog: updateSyncLogMock,
}));

vi.mock("@/lib/github/collectors", () => ({
  RESOURCE_KEYS: [
    "repositories",
    "issues",
    "discussions",
    "pull_requests",
    "reviews",
    "comments",
  ] as const,
  runCollection: runCollectionMock,
  collectPullRequestLinks: collectPullRequestLinksMock,
}));

vi.mock("@/lib/activity/cache", () => ({
  refreshActivityCaches: refreshActivityCachesMock,
  ensureActivityCaches: ensureActivityCachesMock,
}));
vi.mock("@/lib/activity/status-automation", () => ({
  ensureIssueStatusAutomation: ensureIssueStatusAutomationMock,
}));
vi.mock("@/lib/activity/snapshot", () => ({
  refreshActivityItemsSnapshot: refreshActivityItemsSnapshotMock,
}));
vi.mock("@/lib/sync/reaction-refresh", () => ({
  refreshAttentionReactions: refreshAttentionReactionsMock,
}));
vi.mock("@/lib/env", () => ({
  env: {
    GITHUB_ORG: "env-org",
    SYNC_INTERVAL_MINUTES: 15,
  },
}));

vi.mock("@/lib/sync/event-bus", () => ({
  emitSyncEvent: emitSyncEventMock,
}));

function getScheduler() {
  return (
    globalThis as {
      __githubDashboardScheduler?: {
        timer: NodeJS.Timeout | null;
        intervalMs: number | null;
        isEnabled: boolean;
        currentRun: Promise<void> | null;
      };
    }
  ).__githubDashboardScheduler;
}

async function importService() {
  const module = await import("@/lib/sync/service");
  return module;
}

describe("sync service (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as { __githubDashboardScheduler?: unknown }
    ).__githubDashboardScheduler = undefined;
    vi.useRealTimers();
    cleanupRunningSyncRunsMock.mockResolvedValue({ runs: [], logs: [] });
    emitSyncEventMock.mockReset();

    let nextRunId = 1;
    createSyncRunMock.mockImplementation(async () => nextRunId++);
    updateSyncRunStatusMock.mockResolvedValue(undefined);
    getLatestSyncRunsMock.mockResolvedValue([]);
    refreshActivityCachesMock.mockResolvedValue(activityCacheRefreshResultMock);
    ensureActivityCachesMock.mockResolvedValue(null);
    recordSyncLogMock.mockResolvedValue(99);
    updateSyncLogMock.mockResolvedValue(undefined);
    ensureIssueStatusAutomationMock.mockResolvedValue(undefined);
    refreshActivityItemsSnapshotMock.mockResolvedValue(undefined);
    refreshAttentionReactionsMock.mockResolvedValue(undefined);
    getSyncConfigMock.mockImplementation(async () => ({
      org_name: "acme",
      auto_sync_enabled: false,
      sync_interval_minutes: 60,
      timezone: "UTC",
      last_sync_started_at: null,
      last_sync_completed_at: null,
      last_successful_sync_at: "2024-04-01T00:00:00.000Z",
    }));
    getSyncStateMock.mockImplementation(async () => null);
    runCollectionMock.mockImplementation(
      async () =>
        ({
          repositoriesProcessed: 1,
          counts: {
            issues: 1,
            discussions: 1,
            pullRequests: 1,
            reviews: 1,
            comments: 1,
          },
          timestamps: {
            repositories: null,
            issues: null,
            discussions: null,
            pullRequests: null,
            reviews: null,
            comments: null,
          },
        }) satisfies RunCollectionResult,
    );
  });

  it("prevents overlapping incremental runs and releases the lock after completion", async () => {
    vi.resetModules();
    const { runIncrementalSync } = await importService();

    let concurrentRuns = 0;
    let maxConcurrent = 0;

    runCollectionMock.mockImplementation(async () => {
      concurrentRuns += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentRuns);
      await Promise.resolve();
      await Promise.resolve();
      concurrentRuns -= 1;
      return {
        repositoriesProcessed: 1,
        counts: {
          issues: 1,
          discussions: 1,
          pullRequests: 1,
          reviews: 1,
          comments: 1,
        },
        timestamps: {
          repositories: null,
          issues: null,
          discussions: null,
          pullRequests: null,
          reviews: null,
          comments: null,
        },
      } satisfies RunCollectionResult;
    });

    const [first, second] = [
      runIncrementalSync(),
      runIncrementalSync(),
    ] as const;

    await Promise.all([first, second]);

    expect(runCollectionMock).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
    expect(createSyncRunMock).toHaveBeenCalledTimes(2);
    expect(updateSyncRunStatusMock).toHaveBeenCalledTimes(2);
    expect(
      updateSyncRunStatusMock.mock.calls.every((call) => call[1] === "success"),
    ).toBe(true);
    expect(refreshAttentionReactionsMock).toHaveBeenCalledTimes(2);
  });

  it("builds a since map per resource based on sync state and last successful sync", async () => {
    vi.resetModules();

    const stateByResource: Record<
      string,
      { last_item_timestamp: string | null } | null
    > = {
      repositories: { last_item_timestamp: "2024-04-05T10:00:00.000Z" },
      issues: { last_item_timestamp: "invalid-date" },
      discussions: null,
      pull_requests: null,
      reviews: { last_item_timestamp: "2024-03-20T12:00:00.000Z" },
      comments: { last_item_timestamp: "2024-04-10T00:00:00.000Z" },
    };

    getSyncConfigMock.mockImplementation(async () => ({
      org_name: "acme",
      auto_sync_enabled: false,
      sync_interval_minutes: 60,
      timezone: "UTC",
      last_sync_started_at: null,
      last_sync_completed_at: null,
      last_successful_sync_at: "2024-04-01T00:00:00.000Z",
    }));

    getSyncStateMock.mockImplementation(
      async (resource: string) => stateByResource[resource] ?? null,
    );

    const { runIncrementalSync } = await importService();

    await runIncrementalSync();

    expect(runCollectionMock).toHaveBeenCalledTimes(1);
    expect(createSyncRunMock).toHaveBeenCalledWith({
      runType: "automatic",
      strategy: "incremental",
      since: "2024-04-01T00:00:00.000Z",
      until: null,
      startedAt: expect.any(String),
    });
    const firstCall = runCollectionMock.mock.calls[0] as unknown as
      | [
          {
            runId?: number | null;
            since?: string | null;
            sinceByResource?: Partial<Record<string, string | null>>;
          },
        ]
      | undefined;
    const callArgs = firstCall?.[0];
    expect(callArgs?.since).toBe("2024-04-01T00:00:00.000Z");
    expect(callArgs?.runId).toBe(1);
    expect(callArgs?.sinceByResource).toEqual({
      repositories: "2024-04-05T10:00:00.000Z",
      issues: "2024-04-01T00:00:00.000Z",
      discussions: "2024-04-01T00:00:00.000Z",
      pull_requests: "2024-04-01T00:00:00.000Z",
      reviews: "2024-04-01T00:00:00.000Z",
      comments: "2024-04-10T00:00:00.000Z",
    });
    expect(refreshAttentionReactionsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the scheduler alive across failures and clears timers on disable", async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const intervalMinutes = 5;
    const intervalMs = intervalMinutes * 60 * 1000;

    getSyncConfigMock.mockImplementation(async () => ({
      org_name: "acme",
      auto_sync_enabled: false,
      sync_interval_minutes: intervalMinutes,
      timezone: "UTC",
      last_sync_started_at: null,
      last_sync_completed_at: null,
      last_successful_sync_at: "2024-04-01T00:00:00.000Z",
    }));

    runCollectionMock
      .mockResolvedValueOnce({
        repositoriesProcessed: 1,
        counts: {
          issues: 1,
          discussions: 1,
          pullRequests: 1,
          reviews: 1,
          comments: 1,
        },
        timestamps: {
          repositories: null,
          issues: null,
          discussions: null,
          pullRequests: null,
          reviews: null,
          comments: null,
        },
      } satisfies RunCollectionResult)
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce({
        repositoriesProcessed: 1,
        counts: {
          issues: 2,
          discussions: 2,
          pullRequests: 2,
          reviews: 2,
          comments: 2,
        },
        timestamps: {
          repositories: null,
          issues: null,
          discussions: null,
          pullRequests: null,
          reviews: null,
          comments: null,
        },
      } satisfies RunCollectionResult);

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { enableAutomaticSync, disableAutomaticSync } = await importService();

    await enableAutomaticSync({ intervalMinutes });

    let scheduler = getScheduler();
    expect(scheduler?.isEnabled).toBe(true);
    expect(scheduler?.intervalMs).toBe(intervalMs);
    expect(scheduler?.timer).toBeDefined();
    expect(runCollectionMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(intervalMs);
    scheduler = getScheduler();
    await scheduler?.currentRun?.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(intervalMs);
    scheduler = getScheduler();
    await scheduler?.currentRun?.catch(() => undefined);

    expect(runCollectionMock).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[github-dashboard] Automatic sync failed",
      expect.any(Error),
    );

    await disableAutomaticSync();
    const schedulerAfterDisable = getScheduler();
    expect(schedulerAfterDisable?.timer).toBeNull();
    expect(schedulerAfterDisable?.isEnabled).toBe(false);
    expect(updateSyncConfigMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoSyncEnabled: false }),
    );

    consoleSpy.mockRestore();
    expect(createSyncRunMock).toHaveBeenCalledTimes(3);
    const failedUpdates = updateSyncRunStatusMock.mock.calls.filter(
      (call) => call[1] === "failed",
    );
    const successfulUpdates = updateSyncRunStatusMock.mock.calls.filter(
      (call) => call[1] === "success",
    );
    expect(failedUpdates).toHaveLength(1);
    expect(successfulUpdates).toHaveLength(2);
    expect(refreshAttentionReactionsMock).toHaveBeenCalledTimes(2);
  });

  it("resets the lock after failures so subsequent runs can proceed", async () => {
    vi.resetModules();
    runCollectionMock
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValueOnce({
        repositoriesProcessed: 1,
        counts: {
          issues: 1,
          discussions: 1,
          pullRequests: 1,
          reviews: 1,
          comments: 1,
        },
        timestamps: {
          repositories: null,
          issues: null,
          discussions: null,
          pullRequests: null,
          reviews: null,
          comments: null,
        },
      } satisfies RunCollectionResult);

    const { runIncrementalSync } = await importService();

    await expect(runIncrementalSync()).rejects.toThrow("transient failure");
    const secondAttempt = await runIncrementalSync();
    expect(secondAttempt.summary.repositoriesProcessed).toBe(1);
    expect(createSyncRunMock).toHaveBeenCalledTimes(2);
    expect(updateSyncRunStatusMock.mock.calls.map((call) => call[1])).toEqual([
      "failed",
      "success",
    ]);
    expect(refreshAttentionReactionsMock).toHaveBeenCalledTimes(1);
  });

  it("updates sync timestamps when runs fail without touching lastSuccessfulSyncAt", async () => {
    vi.resetModules();

    runCollectionMock.mockRejectedValueOnce(new Error("boom"));

    const updateCalls: Record<string, unknown>[] = [];
    updateSyncConfigMock.mockImplementation(async (params) => {
      updateCalls.push(params);
    });

    const { runIncrementalSync } = await importService();

    await expect(runIncrementalSync()).rejects.toThrow("boom");

    const startedCall = updateCalls.find((call) => "lastSyncStartedAt" in call);
    const completedCall = updateCalls.find(
      (call) =>
        "lastSyncCompletedAt" in call && !("lastSuccessfulSyncAt" in call),
    );

    expect(startedCall?.lastSyncStartedAt).toEqual(expect.any(String));
    expect(completedCall?.lastSyncCompletedAt).toEqual(expect.any(String));
    const successfulCall = updateCalls.find(
      (call) => "lastSuccessfulSyncAt" in call,
    );
    expect(successfulCall).toBeUndefined();
    expect(updateSyncRunStatusMock).toHaveBeenCalledWith(
      1,
      "failed",
      expect.any(String),
    );
    expect(refreshAttentionReactionsMock).not.toHaveBeenCalled();
  });

  it("records the latest resource timestamp as the last successful sync time", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const completedAt = new Date("2024-04-12T12:00:00.000Z");
    vi.setSystemTime(completedAt);

    runCollectionMock.mockResolvedValueOnce({
      repositoriesProcessed: 1,
      counts: {
        issues: 1,
        discussions: 1,
        pullRequests: 1,
        reviews: 1,
        comments: 1,
      },
      timestamps: {
        repositories: "2024-04-12T10:00:00.000Z",
        issues: "2024-04-12T11:30:00.000Z",
        discussions: null,
        pullRequests: "2024-04-12T11:45:00.000Z",
        reviews: null,
        comments: "2024-04-12T11:15:00.000Z",
      },
    } satisfies RunCollectionResult);

    const updateCalls: Record<string, unknown>[] = [];
    updateSyncConfigMock.mockImplementation(async (params) => {
      updateCalls.push(params);
    });

    const { runIncrementalSync } = await importService();
    await runIncrementalSync();

    const successfulCall = updateCalls.find(
      (call) => "lastSuccessfulSyncAt" in call,
    ) as { lastSuccessfulSyncAt?: unknown } | undefined;
    expect(successfulCall?.lastSuccessfulSyncAt).toBe(
      "2024-04-12T11:45:00.000Z",
    );
    const completedCall = updateCalls.find(
      (call) => "lastSyncCompletedAt" in call,
    ) as { lastSyncCompletedAt?: unknown } | undefined;
    expect(completedCall?.lastSyncCompletedAt).toBe(completedAt.toISOString());

    expect(updateSyncRunStatusMock).toHaveBeenCalledWith(
      1,
      "success",
      completedAt.toISOString(),
    );

    vi.useRealTimers();
    expect(refreshAttentionReactionsMock).toHaveBeenCalledTimes(1);
  });

  it("emits run completion only after post-sync steps finish", async () => {
    vi.resetModules();
    const { runIncrementalSync } = await importService();

    await runIncrementalSync();

    const runCompletedIndex = emitSyncEventMock.mock.calls.findIndex(
      (call) => call[0]?.type === "run-completed",
    );
    expect(runCompletedIndex).toBeGreaterThanOrEqual(0);

    const runCompletedOrder =
      emitSyncEventMock.mock.invocationCallOrder[runCompletedIndex];
    expect(runCompletedOrder).toBeDefined();

    expect(refreshAttentionReactionsMock).toHaveBeenCalledTimes(1);
    expect(ensureIssueStatusAutomationMock).toHaveBeenCalledTimes(1);
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(refreshActivityCachesMock).toHaveBeenCalledTimes(1);

    expect(runCompletedOrder).toBeGreaterThan(
      refreshAttentionReactionsMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(runCompletedOrder).toBeGreaterThan(
      ensureIssueStatusAutomationMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(runCompletedOrder).toBeGreaterThan(
      refreshActivityItemsSnapshotMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(runCompletedOrder).toBeGreaterThan(
      refreshActivityCachesMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("emits failure events when cleanup marks running syncs as failed", async () => {
    vi.resetModules();
    const completedAt = "2024-05-01T00:05:00.000Z";
    const startedAt = "2024-05-01T00:00:00.000Z";
    cleanupRunningSyncRunsMock.mockResolvedValueOnce({
      runs: [
        {
          id: 42,
          run_type: "manual",
          strategy: "incremental",
          since: null,
          until: null,
          status: "failed",
          started_at: startedAt,
          completed_at: completedAt,
        },
      ],
      logs: [
        {
          id: 7,
          run_id: 42,
          resource: "issues",
          status: "failed",
          message: "forced failure",
          started_at: startedAt,
          finished_at: completedAt,
        },
      ],
    });

    const { cleanupStuckSyncRuns } = await importService();
    const result = await cleanupStuckSyncRuns({ actorId: "admin-user" });

    expect(result).toEqual({ runCount: 1, logCount: 1 });
    expect(cleanupRunningSyncRunsMock).toHaveBeenCalledTimes(1);
    expect(emitSyncEventMock).toHaveBeenNthCalledWith(1, {
      type: "run-status",
      runId: 42,
      status: "failed",
      completedAt,
    });
    expect(emitSyncEventMock).toHaveBeenNthCalledWith(2, {
      type: "run-failed",
      runId: 42,
      status: "failed",
      finishedAt: completedAt,
      error: "Marked as failed by admin cleanup.",
    });
    expect(emitSyncEventMock).toHaveBeenNthCalledWith(3, {
      type: "log-updated",
      logId: 7,
      runId: 42,
      resource: "issues",
      status: "failed",
      message: "forced failure",
      finishedAt: completedAt,
    });
  });

  it("returns zero counts when no running syncs exist", async () => {
    vi.resetModules();
    cleanupRunningSyncRunsMock.mockResolvedValueOnce({ runs: [], logs: [] });

    const { cleanupStuckSyncRuns } = await importService();
    const result = await cleanupStuckSyncRuns();

    expect(result).toEqual({ runCount: 0, logCount: 0 });
    expect(emitSyncEventMock).not.toHaveBeenCalled();
  });

  it("runs PR link backfill and returns summary", async () => {
    vi.useFakeTimers();
    const now = new Date("2024-04-02T00:00:00.000Z");
    vi.setSystemTime(now);

    collectPullRequestLinksMock.mockResolvedValueOnce({
      repositoriesProcessed: 3,
      pullRequestCount: 12,
      latestPullRequestUpdated: "2024-04-15T00:00:00.000Z",
    });

    const { runPrLinkBackfill } = await importService();
    const result = await runPrLinkBackfill("2024-04-01");

    expect(result).toEqual({
      startDate: "2024-04-01T00:00:00.000Z",
      endDate: null,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      repositoriesProcessed: 3,
      pullRequestCount: 12,
      latestPullRequestUpdated: "2024-04-15T00:00:00.000Z",
    });

    expect(collectPullRequestLinksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        sinceByResource: { pull_requests: "2024-04-01T00:00:00.000Z" },
        until: "2024-04-02T00:00:00.000Z",
      }),
    );

    expect(createSyncRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runType: "backfill",
        strategy: "backfill",
        since: "2024-04-01T00:00:00.000Z",
        startedAt: now.toISOString(),
        until: null,
      }),
    );
    expect(updateSyncRunStatusMock).toHaveBeenCalledWith(
      1,
      "success",
      expect.any(String),
    );
    expect(emitSyncEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run-started", runId: 1 }),
    );
    expect(emitSyncEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run-completed", runId: 1 }),
    );

    vi.useRealTimers();
  });

  it("runs PR link backfill with an end date and forwards the until boundary", async () => {
    vi.useFakeTimers();
    const now = new Date("2024-05-01T12:00:00.000Z");
    vi.setSystemTime(now);

    collectPullRequestLinksMock
      .mockResolvedValueOnce({
        repositoriesProcessed: 1,
        pullRequestCount: 3,
        latestPullRequestUpdated: "2024-04-02T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        repositoriesProcessed: 2,
        pullRequestCount: 1,
        latestPullRequestUpdated: "2024-04-03T00:00:00.000Z",
      });

    const { runPrLinkBackfill } = await importService();
    const result = await runPrLinkBackfill("2024-04-01", "2024-04-02");

    expect(result).toEqual({
      startDate: "2024-04-01T00:00:00.000Z",
      endDate: "2024-04-02T00:00:00.000Z",
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      repositoriesProcessed: 2,
      pullRequestCount: 4,
      latestPullRequestUpdated: "2024-04-03T00:00:00.000Z",
    });

    expect(collectPullRequestLinksMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sinceByResource: { pull_requests: "2024-04-01T00:00:00.000Z" },
        until: "2024-04-02T00:00:00.000Z",
      }),
    );
    expect(collectPullRequestLinksMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sinceByResource: { pull_requests: "2024-04-02T00:00:00.000Z" },
        until: "2024-04-03T00:00:00.000Z",
      }),
    );

    expect(createSyncRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        since: "2024-04-01T00:00:00.000Z",
        until: "2024-04-03T00:00:00.000Z",
      }),
    );

    vi.useRealTimers();
  });
});
