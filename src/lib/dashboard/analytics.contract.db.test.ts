// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { ensureSchema } from "@/lib/db";
import type {
  DbActor,
  DbIssue,
  DbPullRequest,
  DbRepository,
} from "@/lib/db/operations";
import {
  updateSyncConfig,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  resetDashboardAndSyncTables,
} from "../../../tests/helpers/dashboard-metrics";

function createActor(id: string, login: string, name: string): DbActor {
  return {
    id,
    login,
    name,
    createdAt: CURRENT_RANGE_START,
    updatedAt: CURRENT_RANGE_START,
  };
}

function createRepository(id: string, ownerId: string): DbRepository {
  return {
    id,
    name: id,
    nameWithOwner: `acme/${id}`,
    ownerId,
    raw: { id },
  };
}

function createIssue(params: {
  id: string;
  repositoryId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  number?: number;
}): DbIssue {
  const {
    id,
    repositoryId,
    authorId,
    createdAt,
    updatedAt,
    number = 1,
  } = params;
  return {
    id,
    number,
    repositoryId,
    authorId,
    title: id,
    state: "OPEN",
    createdAt,
    updatedAt,
    raw: {
      author: { id: authorId },
      trackedIssues: { totalCount: 0 },
      trackedInIssues: { totalCount: 0 },
      projectItems: { nodes: [] },
      timelineItems: { nodes: [] },
      reactions: { nodes: [] },
    },
  };
}

function createPullRequest(params: {
  id: string;
  repositoryId: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  number?: number;
}): DbPullRequest {
  const {
    id,
    repositoryId,
    authorId,
    createdAt,
    updatedAt,
    mergedAt = null,
    number = 1,
  } = params;
  return {
    id,
    number,
    repositoryId,
    authorId,
    title: id,
    state: mergedAt ? "MERGED" : "OPEN",
    createdAt,
    updatedAt,
    closedAt: mergedAt,
    mergedAt,
    merged: mergedAt != null,
    raw: {
      author: { id: authorId },
      comments: { totalCount: 0 },
      additions: 0,
      deletions: 0,
    },
  };
}

describe("getDashboardAnalytics contract coverage", () => {
  beforeEach(async () => {
    await ensureSchema();
    await resetDashboardAndSyncTables();
    await updateSyncConfig({
      orgName: "acme",
      timezone: "UTC",
      weekStart: "monday",
      excludedUsers: [],
      excludedRepositories: [],
    });
  });

  it("returns zeroed metrics and consistent history when there is no activity", async () => {
    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    expect(analytics.repositories).toEqual([]);
    expect(analytics.contributors).toEqual([]);
    expect(analytics.organization.activityBreakdown).toEqual({
      issues: 0,
      pullRequests: 0,
      reviews: 0,
      comments: 0,
    });
    expect(analytics.organization.metrics.issuesCreated.current).toBe(0);
    expect(analytics.organization.metrics.totalEvents.current).toBe(0);
    Object.values(analytics.organization.metricHistory).forEach((series) => {
      expect(Array.isArray(series)).toBe(true);
      expect(series).toHaveLength(5);
      series.forEach((entry) => {
        expect(entry.period).toBeDefined();
        expect(entry.value === null || entry.value === 0).toBe(true);
      });
    });
    expect(analytics.organization.reviewers).toEqual([]);
    expect(analytics.organization.repoDistribution).toEqual([]);
    expect(analytics.organization.repoComparison).toEqual([]);
    expect(analytics.timeZone).toBe("UTC");
    expect(analytics.weekStart).toBe("monday");
    expect(analytics.individual).toBeNull();
  });

  it("excludes dependabot style logins and configured people from aggregates", async () => {
    const human = createActor("user-human", "octocat", "Octo Cat");
    const bot = createActor("user-bot", "dependabot[bot]", "Dependabot");
    const repository = createRepository("repo-exclude-test", human.id);

    await upsertUser(human);
    await upsertUser(bot);
    await upsertRepository(repository);
    await upsertIssue(
      createIssue({
        id: "issue-human",
        repositoryId: repository.id,
        authorId: human.id,
        createdAt: "2024-01-02T10:00:00.000Z",
        updatedAt: "2024-01-02T12:00:00.000Z",
      }),
    );
    await upsertPullRequest(
      createPullRequest({
        id: "pr-human",
        repositoryId: repository.id,
        authorId: human.id,
        createdAt: "2024-01-03T08:00:00.000Z",
        updatedAt: "2024-01-03T09:00:00.000Z",
      }),
    );
    await upsertPullRequest(
      createPullRequest({
        id: "pr-dependabot",
        repositoryId: repository.id,
        authorId: bot.id,
        createdAt: "2024-01-04T08:00:00.000Z",
        updatedAt: "2024-01-04T08:30:00.000Z",
        number: 2,
      }),
    );

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    expect(analytics.organization.metrics.issuesCreated.current).toBe(1);
    expect(analytics.organization.metrics.prsCreated.current).toBe(1);
    expect(analytics.organization.activityBreakdown.issues).toBe(1);
    expect(
      analytics.contributors.map((contributor) => contributor.id).sort(),
    ).toEqual([bot.id, human.id].sort());

    await updateSyncConfig({
      excludedUsers: [human.id],
    });

    const excludedAnalytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });
    expect(excludedAnalytics.organization.metrics.prsCreated.current).toBe(1);
    expect(
      excludedAnalytics.contributors.map((contributor) => contributor.id),
    ).toEqual([bot.id]);
  });

  it("filters analytics when specific repositoryIds are supplied", async () => {
    const actor = createActor("filter-actor", "filter", "Filter User");
    const repoAlpha = createRepository("repo-alpha", actor.id);
    const repoBeta = createRepository("repo-beta", actor.id);

    await upsertUser(actor);
    await Promise.all([
      upsertRepository(repoAlpha),
      upsertRepository(repoBeta),
    ]);

    await Promise.all([
      upsertIssue(
        createIssue({
          id: "issue-alpha",
          repositoryId: repoAlpha.id,
          authorId: actor.id,
          createdAt: "2024-01-02T08:00:00.000Z",
          updatedAt: "2024-01-02T09:00:00.000Z",
        }),
      ),
      upsertIssue(
        createIssue({
          id: "issue-beta",
          repositoryId: repoBeta.id,
          authorId: actor.id,
          createdAt: "2024-01-02T10:00:00.000Z",
          updatedAt: "2024-01-02T11:00:00.000Z",
          number: 2,
        }),
      ),
    ]);

    const allAnalytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });
    expect(allAnalytics.organization.activityBreakdown.issues).toBe(2);

    const filteredAnalytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      repositoryIds: [repoAlpha.id],
    });

    expect(filteredAnalytics.organization.activityBreakdown.issues).toBe(1);
    expect(
      filteredAnalytics.organization.repoDistribution.map(
        (entry) => entry.repositoryId,
      ),
    ).toEqual([repoAlpha.id]);
  });
});
