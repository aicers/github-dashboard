// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import type {
  DbActor,
  DbComment,
  DbIssue,
  DbPullRequest,
  DbReview,
  SyncLogStatus,
} from "@/lib/db/operations";
import {
  getSyncConfig,
  recordSyncLog,
  updateSyncConfig,
  updateSyncLog,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import * as collectors from "@/lib/github/collectors";
import { resetDashboardAndSyncTables } from "../../../tests/helpers/dashboard-metrics";

let fetchSyncStatus: typeof import("@/lib/sync/service")["fetchSyncStatus"];
let runIncrementalSync: typeof import("@/lib/sync/service")["runIncrementalSync"];
let runBackfill: typeof import("@/lib/sync/service")["runBackfill"];
let resetSyncData: typeof import("@/lib/sync/service")["resetData"];

const BASE_TIME = new Date("2024-04-10T00:00:00.000Z");

function ensureLogId(id: number | undefined): number {
  if (typeof id !== "number") {
    throw new Error("Expected log identifier");
  }
  return id;
}

async function createActor(id: string): Promise<DbActor> {
  const actor: DbActor = {
    id,
    login: id,
    name: `${id} name`,
    createdAt: BASE_TIME.toISOString(),
    updatedAt: BASE_TIME.toISOString(),
  };
  await upsertUser(actor);
  return actor;
}

async function createRepository(id: string, ownerId: string) {
  await upsertRepository({
    id,
    name: id,
    nameWithOwner: `acme/${id}`,
    ownerId,
    raw: { id },
    createdAt: BASE_TIME.toISOString(),
    updatedAt: BASE_TIME.toISOString(),
  });
}

describe("sync service database integration", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await ensureSchema();
    await resetDashboardAndSyncTables();
    await updateSyncConfig({
      orgName: "acme",
      autoSyncEnabled: false,
      syncIntervalMinutes: 60,
      timezone: "UTC",
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSuccessfulSyncAt: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeAll(async () => {
    ({
      fetchSyncStatus,
      runIncrementalSync,
      runBackfill,
      resetData: resetSyncData,
    } = await import("@/lib/sync/service"));
  });

  describe("fetchSyncStatus", () => {
    it("returns the latest 20 logs together with sync configuration and freshness", async () => {
      const now = new Date("2024-05-01T09:00:00.000Z");
      const lastStarted = new Date(now.getTime() - 60_000).toISOString();
      const lastCompleted = new Date(now.getTime() - 30_000).toISOString();
      const lastSuccessful = new Date(now.getTime() - 10_000).toISOString();

      await updateSyncConfig({
        orgName: "acme-corp",
        autoSyncEnabled: true,
        syncIntervalMinutes: 45,
        timezone: "Asia/Seoul",
        lastSyncStartedAt: lastStarted,
        lastSyncCompletedAt: lastCompleted,
        lastSuccessfulSyncAt: lastSuccessful,
      });

      const statuses: SyncLogStatus[] = ["success", "failed", "running"];
      const baseStarted = new Date("2024-04-30T00:00:00.000Z");
      for (let index = 0; index < 25; index += 1) {
        const resource = `resource-${index}`;
        const logId = ensureLogId(
          await recordSyncLog(resource, "running", `collect-${index}`),
        );
        await updateSyncLog(logId, statuses[index % statuses.length], "done");
        const startedAt = new Date(baseStarted.getTime() + index * 3_600_000);
        const finishedAt = new Date(startedAt.getTime() + 5_000);
        await query(
          `UPDATE sync_log SET started_at = $1, finished_at = $2 WHERE id = $3`,
          [startedAt.toISOString(), finishedAt.toISOString(), logId],
        );
      }

      const status = await fetchSyncStatus();

      expect(status.config?.org_name).toBe("acme-corp");
      expect(status.config?.auto_sync_enabled).toBe(true);
      expect(status.config?.sync_interval_minutes).toBe(45);
      expect(status.config?.timezone).toBe("Asia/Seoul");
      const startedIso =
        status.config?.last_sync_started_at instanceof Date
          ? status.config.last_sync_started_at.toISOString()
          : status.config?.last_sync_started_at;
      const completedIso =
        status.config?.last_sync_completed_at instanceof Date
          ? status.config.last_sync_completed_at.toISOString()
          : status.config?.last_sync_completed_at;
      const successfulIso =
        status.config?.last_successful_sync_at instanceof Date
          ? status.config.last_successful_sync_at.toISOString()
          : status.config?.last_successful_sync_at;

      expect(startedIso).toBe(lastStarted);
      expect(completedIso).toBe(lastCompleted);
      expect(successfulIso).toBe(lastSuccessful);
      const freshnessIso =
        status.dataFreshness instanceof Date
          ? status.dataFreshness.toISOString()
          : status.dataFreshness;
      expect(freshnessIso).toBe(lastSuccessful);

      expect(status.logs).toHaveLength(20);
      expect(status.logs[0].resource).toBe("resource-24");
      expect(status.logs.at(-1)?.resource).toBe("resource-5");
      const expectedLatestStatus = statuses[24 % statuses.length];
      expect(status.logs[0].status).toBe(expectedLatestStatus);
      expect(status.logs[0].finished_at).not.toBeNull();
    });
  });

  describe("runIncrementalSync", () => {
    it("records the latest resource timestamp as the last successful sync time", async () => {
      vi.useFakeTimers();
      const completedAt = new Date("2024-04-12T12:00:00.000Z");
      vi.setSystemTime(completedAt);

      const runCollectionSpy = vi.spyOn(collectors, "runCollection");
      runCollectionSpy.mockResolvedValueOnce({
        repositoriesProcessed: 1,
        counts: {
          issues: 3,
          discussions: 2,
          pullRequests: 4,
          reviews: 1,
          comments: 5,
        },
        timestamps: {
          repositories: "2024-04-12T10:00:00.000Z",
          issues: "2024-04-12T11:30:00.000Z",
          discussions: null,
          pullRequests: "2024-04-12T11:45:00.000Z",
          reviews: null,
          comments: "2024-04-12T11:40:00.000Z",
        },
      } satisfies Awaited<ReturnType<typeof collectors.runCollection>>);

      await runIncrementalSync();

      expect(runCollectionSpy).toHaveBeenCalledTimes(1);
      const latestConfig = await getSyncConfig();
      const completedIso =
        latestConfig?.last_sync_completed_at instanceof Date
          ? latestConfig.last_sync_completed_at.toISOString()
          : latestConfig?.last_sync_completed_at;
      const successfulIso =
        latestConfig?.last_successful_sync_at instanceof Date
          ? latestConfig.last_successful_sync_at.toISOString()
          : latestConfig?.last_successful_sync_at;

      expect(completedIso).toBe(completedAt.toISOString());
      expect(successfulIso).toBe("2024-04-12T11:45:00.000Z");
    });
  });

  describe("runBackfill", () => {
    it("splits the requested range into day chunks, aggregates totals, and updates sync metadata", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-04-05T00:00:00.000Z"));

      const runCollectionSpy = vi.spyOn(collectors, "runCollection");
      runCollectionSpy
        .mockResolvedValueOnce({
          repositoriesProcessed: 1,
          counts: {
            issues: 5,
            discussions: 2,
            pullRequests: 3,
            reviews: 2,
            comments: 4,
          },
          timestamps: {
            repositories: null,
            issues: null,
            discussions: null,
            pullRequests: null,
            reviews: null,
            comments: null,
          },
        })
        .mockResolvedValueOnce({
          repositoriesProcessed: 2,
          counts: {
            issues: 2,
            discussions: 1,
            pullRequests: 4,
            reviews: 1,
            comments: 3,
          },
          timestamps: {
            repositories: null,
            issues: null,
            discussions: null,
            pullRequests: null,
            reviews: null,
            comments: null,
          },
        });

      const result = await runBackfill("2024-04-03");

      expect(runCollectionSpy).toHaveBeenCalledTimes(2);
      expect(runCollectionSpy.mock.calls[0]?.[0]).toMatchObject({
        since: "2024-04-03T00:00:00.000Z",
        until: "2024-04-04T00:00:00.000Z",
      });
      expect(runCollectionSpy.mock.calls[1]?.[0]).toMatchObject({
        since: "2024-04-04T00:00:00.000Z",
        until: "2024-04-05T00:00:00.000Z",
      });

      expect(result.chunkCount).toBe(2);
      expect(result.startDate).toBe("2024-04-03T00:00:00.000Z");
      expect(result.endDate).toBe("2024-04-05T00:00:00.000Z");
      expect(result.totals).toEqual({
        issues: 7,
        discussions: 3,
        pullRequests: 7,
        reviews: 3,
        comments: 7,
      });
      expect(result.chunks.every((chunk) => chunk.status === "success")).toBe(
        true,
      );

      const latestConfig = await getSyncConfig();
      expect(latestConfig?.last_sync_started_at).not.toBeNull();
      expect(latestConfig?.last_sync_completed_at).not.toBeNull();
      const finalSuccessfulIso =
        latestConfig?.last_successful_sync_at instanceof Date
          ? latestConfig.last_successful_sync_at.toISOString()
          : latestConfig?.last_successful_sync_at;
      const lastChunk = result.chunks.at(-1);
      const lastCompletedAt =
        lastChunk?.status === "success" ? lastChunk.completedAt : null;
      expect(finalSuccessfulIso).toBe(lastCompletedAt);
    });

    it("records the first failure and stops further processing without overriding the last successful timestamp", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-04-05T00:00:00.000Z"));

      const runCollectionSpy = vi.spyOn(collectors, "runCollection");
      runCollectionSpy
        .mockResolvedValueOnce({
          repositoriesProcessed: 1,
          counts: {
            issues: 3,
            discussions: 1,
            pullRequests: 2,
            reviews: 1,
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
        })
        .mockRejectedValueOnce(new Error("network boom"));

      const result = await runBackfill("2024-04-03");

      expect(runCollectionSpy).toHaveBeenCalledTimes(2);
      expect(result.chunkCount).toBe(2);
      const [firstChunk, secondChunk] = result.chunks;
      expect(firstChunk.status).toBe("success");
      expect(secondChunk.status).toBe("failed");
      if (secondChunk.status === "failed") {
        expect(secondChunk.error).toContain("network boom");
        expect(secondChunk.since).toBe("2024-04-04T00:00:00.000Z");
        expect(secondChunk.until).toBe("2024-04-05T00:00:00.000Z");
      }

      const latestConfig = await getSyncConfig();
      const lastSuccessfulIso =
        latestConfig?.last_successful_sync_at instanceof Date
          ? latestConfig.last_successful_sync_at.toISOString()
          : latestConfig?.last_successful_sync_at;

      expect(lastSuccessfulIso).toBe(
        firstChunk.status === "success" ? firstChunk.completedAt : null,
      );
      expect(latestConfig?.last_sync_completed_at).not.toBeNull();
    });
  });

  describe("resetData", () => {
    it("removes domain data, keeps logs when requested, and clears sync timestamps", async () => {
      const actor = await createActor("actor-1");
      await createRepository("repo-1", actor.id);

      const issue: DbIssue = {
        id: "issue-1",
        number: 1,
        repositoryId: "repo-1",
        authorId: actor.id,
        title: "Issue title",
        state: "OPEN",
        createdAt: BASE_TIME.toISOString(),
        updatedAt: BASE_TIME.toISOString(),
        raw: { id: "issue-1" },
      };
      await upsertIssue(issue);

      const pr: DbPullRequest = {
        id: "pr-1",
        number: 1,
        repositoryId: "repo-1",
        authorId: actor.id,
        title: "PR title",
        state: "OPEN",
        createdAt: BASE_TIME.toISOString(),
        updatedAt: BASE_TIME.toISOString(),
        raw: { id: "pr-1" },
      };
      await upsertPullRequest(pr);

      const review: DbReview = {
        id: "review-1",
        pullRequestId: pr.id,
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: BASE_TIME.toISOString(),
        raw: { id: "review-1" },
      };
      await upsertReview(review);

      const comment: DbComment = {
        id: "comment-1",
        pullRequestId: pr.id,
        authorId: actor.id,
        createdAt: BASE_TIME.toISOString(),
        updatedAt: BASE_TIME.toISOString(),
        raw: { id: "comment-1" },
      };
      await upsertComment(comment);

      const logId = ensureLogId(
        await recordSyncLog("issues", "running", "collect"),
      );
      await updateSyncLog(logId, "success", "done");

      await updateSyncConfig({
        lastSyncStartedAt: BASE_TIME.toISOString(),
        lastSyncCompletedAt: BASE_TIME.toISOString(),
        lastSuccessfulSyncAt: BASE_TIME.toISOString(),
      });

      await resetSyncData({ preserveLogs: true });

      const [issueCount, prCount, reviewCount, commentCount, logCount] =
        await Promise.all([
          query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM issues",
          ),
          query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM pull_requests",
          ),
          query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM reviews",
          ),
          query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM comments",
          ),
          query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM sync_log",
          ),
        ]);

      expect(Number(issueCount.rows[0]?.count ?? "0")).toBe(0);
      expect(Number(prCount.rows[0]?.count ?? "0")).toBe(0);
      expect(Number(reviewCount.rows[0]?.count ?? "0")).toBe(0);
      expect(Number(commentCount.rows[0]?.count ?? "0")).toBe(0);
      expect(Number(logCount.rows[0]?.count ?? "0")).toBeGreaterThan(0);

      const latestConfig = await getSyncConfig();
      expect(latestConfig?.last_sync_started_at).toBeNull();
      expect(latestConfig?.last_sync_completed_at).toBeNull();
      expect(latestConfig?.last_successful_sync_at).toBeNull();
    });
  });
});
