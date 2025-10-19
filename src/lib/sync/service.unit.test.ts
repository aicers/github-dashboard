import { beforeEach, describe, expect, it, vi } from "vitest";

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
const getDataFreshnessMock = vi.fn(async () => null);
const getDashboardStatsMock = vi.fn(async () => ({ repositories: 0 }));

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

vi.mock("@/lib/db", () => ({
  ensureSchema: ensureSchemaMock,
}));

vi.mock("@/lib/db/operations", () => ({
  getSyncConfig: getSyncConfigMock,
  updateSyncConfig: updateSyncConfigMock,
  getSyncState: getSyncStateMock,
  resetData: resetDataMock,
  getLatestSyncLogs: getLatestSyncLogsMock,
  getDataFreshness: getDataFreshnessMock,
  getDashboardStats: getDashboardStatsMock,
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
}));

vi.mock("@/lib/env", () => ({
  env: {
    GITHUB_ORG: "env-org",
    SYNC_INTERVAL_MINUTES: 15,
  },
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
    const firstCall = runCollectionMock.mock.calls[0] as unknown as
      | [
          {
            since?: string | null;
            sinceByResource?: Partial<Record<string, string | null>>;
          },
        ]
      | undefined;
    const callArgs = firstCall?.[0];
    expect(callArgs?.since).toBe("2024-04-01T00:00:00.000Z");
    expect(callArgs?.sinceByResource).toEqual({
      repositories: "2024-04-05T10:00:00.000Z",
      issues: "2024-04-01T00:00:00.000Z",
      discussions: "2024-04-01T00:00:00.000Z",
      pull_requests: "2024-04-01T00:00:00.000Z",
      reviews: "2024-04-01T00:00:00.000Z",
      comments: "2024-04-10T00:00:00.000Z",
    });
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

    vi.useRealTimers();
  });
});
