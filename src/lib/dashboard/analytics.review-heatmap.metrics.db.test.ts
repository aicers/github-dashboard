import "../../../tests/helpers/postgres-container";
import "@testing-library/jest-dom";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  updateSyncConfig,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import { ensureSchema } from "@/lib/db/schema";

const RANGE_START = "2024-05-01T00:00:00.000Z";
const RANGE_END = "2024-05-31T23:59:59.999Z";
const TIMEZONE = "America/Los_Angeles";

async function seedRepositories(repositories: readonly DbRepository[]) {
  for (const repository of repositories) {
    await upsertRepository(repository);
  }
}

async function seedUsers(users: readonly DbActor[]) {
  for (const user of users) {
    await upsertUser(user);
  }
}

describe("analytics review heatmap", () => {
  beforeEach(async () => {
    await ensureSchema();
    await query(
      "TRUNCATE TABLE comments, reviews, review_requests, pull_requests, issues, reactions, repositories, users RESTART IDENTITY CASCADE",
    );
    await query("TRUNCATE TABLE sync_log, sync_state RESTART IDENTITY CASCADE");
    await updateSyncConfig({
      timezone: TIMEZONE,
      excludedRepositories: [],
      excludedUsers: [],
    });
  });

  it("builds review heatmap buckets with timezone adjustment and repository filtering", async () => {
    const repositoryTarget: DbRepository = {
      id: "repo-heatmap-target",
      name: "heatmap-target",
      nameWithOwner: "octo/heatmap-target",
      raw: { id: "repo-heatmap-target" },
    };
    const repositoryOther: DbRepository = {
      id: "repo-heatmap-other",
      name: "heatmap-other",
      nameWithOwner: "octo/heatmap-other",
      raw: { id: "repo-heatmap-other" },
    };

    await seedRepositories([repositoryTarget, repositoryOther]);

    const authorTarget: DbActor = {
      id: "user-author-target",
      login: "author-target",
      name: "Author Target",
    };
    const authorOther: DbActor = {
      id: "user-author-other",
      login: "author-other",
      name: "Author Other",
    };
    const reviewerOne: DbActor = {
      id: "user-reviewer-one",
      login: "reviewer-one",
      name: "Reviewer One",
    };
    const reviewerTwo: DbActor = {
      id: "user-reviewer-two",
      login: "reviewer-two",
      name: "Reviewer Two",
    };

    await seedUsers([authorTarget, authorOther, reviewerOne, reviewerTwo]);

    const pullRequests: DbPullRequest[] = [
      {
        id: "pr-heatmap-target",
        number: 101,
        repositoryId: repositoryTarget.id,
        authorId: authorTarget.id,
        title: "Target PR",
        state: "OPEN",
        merged: false,
        createdAt: "2024-05-04T09:00:00.000Z",
        updatedAt: "2024-05-04T09:00:00.000Z",
        raw: { id: "pr-heatmap-target" },
      },
      {
        id: "pr-heatmap-other",
        number: 102,
        repositoryId: repositoryOther.id,
        authorId: authorOther.id,
        title: "Other PR",
        state: "OPEN",
        merged: false,
        createdAt: "2024-05-06T10:00:00.000Z",
        updatedAt: "2024-05-06T10:00:00.000Z",
        raw: { id: "pr-heatmap-other" },
      },
    ];

    for (const pullRequest of pullRequests) {
      await upsertPullRequest(pullRequest);
    }

    const reviews: DbReview[] = [
      {
        id: "review-target-1",
        pullRequestId: "pr-heatmap-target",
        authorId: reviewerOne.id,
        state: "APPROVED",
        submittedAt: "2024-05-05T08:30:00.000Z",
        raw: { id: "review-target-1" },
      },
      {
        id: "review-target-2",
        pullRequestId: "pr-heatmap-target",
        authorId: reviewerTwo.id,
        state: "COMMENTED",
        submittedAt: "2024-05-05T08:45:00.000Z",
        raw: { id: "review-target-2" },
      },
      {
        id: "review-target-3",
        pullRequestId: "pr-heatmap-target",
        authorId: reviewerOne.id,
        state: "APPROVED",
        submittedAt: "2024-05-06T15:00:00.000Z",
        raw: { id: "review-target-3" },
      },
      {
        id: "review-other-1",
        pullRequestId: "pr-heatmap-other",
        authorId: reviewerOne.id,
        state: "COMMENTED",
        submittedAt: "2024-05-06T23:30:00.000Z",
        raw: { id: "review-other-1" },
      },
    ];

    for (const review of reviews) {
      await upsertReview(review);
    }

    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const heatmap = analytics.organization.trends.reviewHeatmap;
    expect(heatmap).toEqual([
      { day: 0, hour: 1, count: 2 },
      { day: 1, hour: 8, count: 1 },
      { day: 1, hour: 16, count: 1 },
    ]);

    const filteredAnalytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
      repositoryIds: [repositoryTarget.id],
    });

    expect(filteredAnalytics.organization.trends.reviewHeatmap).toEqual([
      { day: 0, hour: 1, count: 2 },
      { day: 1, hour: 8, count: 1 },
    ]);
  });
});
