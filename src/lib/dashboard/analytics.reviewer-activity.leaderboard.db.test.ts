// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const RANGE_START = "2024-03-01T00:00:00.000Z";
const RANGE_END = "2024-03-31T23:59:59.999Z";

function buildActor(id: string, login: string, name?: string): DbActor {
  return {
    id,
    login,
    name: name ?? login,
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  };
}

async function seedReviewerActivityScenario() {
  const owner = buildActor("user-owner", "octo-owner", "Octo Owner");
  const authorA = buildActor("user-author-a", "octo-author-a", "Octo Author A");
  const authorB = buildActor("user-author-b", "octo-author-b", "Octo Author B");
  const dependabot: DbActor = {
    id: "user-dependabot",
    login: "dependabot[bot]",
    name: "Dependabot",
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  };
  const reviewers = [
    buildActor("user-alice", "alice", "Alice Reviewer"),
    buildActor("user-brad", "brad", "Brad Reviewer"),
    buildActor("user-diana", "diana", "Diana Reviewer"),
    buildActor("user-chris", "chris", "Chris Reviewer"),
  ];

  for (const actor of [owner, authorA, authorB, dependabot, ...reviewers]) {
    await upsertUser(actor);
  }

  const repository: DbRepository = {
    id: "repo-activity",
    name: "activity",
    nameWithOwner: "octo/activity",
    ownerId: owner.id,
    raw: { id: "repo-activity" },
  };
  await upsertRepository(repository);

  const pullRequests: DbPullRequest[] = [
    {
      id: "repo-activity-pr-alpha",
      number: 1,
      repositoryId: repository.id,
      authorId: authorA.id,
      title: "Alpha PR",
      state: "MERGED",
      merged: true,
      createdAt: "2024-03-05T09:00:00.000Z",
      updatedAt: "2024-03-20T09:00:00.000Z",
      closedAt: "2024-03-20T09:00:00.000Z",
      mergedAt: "2024-03-20T09:00:00.000Z",
      raw: {
        author: { id: authorA.id },
        additions: 120,
        deletions: 15,
      },
    },
    {
      id: "repo-activity-pr-beta",
      number: 2,
      repositoryId: repository.id,
      authorId: authorB.id,
      title: "Beta PR",
      state: "MERGED",
      merged: true,
      createdAt: "2024-03-16T10:00:00.000Z",
      updatedAt: "2024-03-21T10:00:00.000Z",
      closedAt: "2024-03-21T10:00:00.000Z",
      mergedAt: "2024-03-21T10:00:00.000Z",
      raw: {
        author: { id: authorB.id },
        additions: 80,
        deletions: 20,
      },
    },
    {
      id: "repo-activity-pr-gamma",
      number: 3,
      repositoryId: repository.id,
      authorId: authorA.id,
      title: "Gamma PR",
      state: "MERGED",
      merged: true,
      createdAt: "2024-03-18T11:00:00.000Z",
      updatedAt: "2024-03-24T11:00:00.000Z",
      closedAt: "2024-03-24T11:00:00.000Z",
      mergedAt: "2024-03-24T11:00:00.000Z",
      raw: {
        author: { id: authorA.id },
        additions: 40,
        deletions: 5,
      },
    },
    {
      id: "repo-activity-pr-delta",
      number: 4,
      repositoryId: repository.id,
      authorId: authorB.id,
      title: "Delta PR",
      state: "MERGED",
      merged: true,
      createdAt: "2024-03-25T09:00:00.000Z",
      updatedAt: "2024-03-27T09:00:00.000Z",
      closedAt: "2024-03-27T09:00:00.000Z",
      mergedAt: "2024-03-27T09:00:00.000Z",
      raw: {
        author: { id: authorB.id },
        additions: 55,
        deletions: 12,
      },
    },
    {
      id: "repo-activity-pr-dependabot",
      number: 5,
      repositoryId: repository.id,
      authorId: dependabot.id,
      title: "Dependabot PR",
      state: "MERGED",
      merged: true,
      createdAt: "2024-03-20T08:00:00.000Z",
      updatedAt: "2024-03-23T08:00:00.000Z",
      closedAt: "2024-03-23T08:00:00.000Z",
      mergedAt: "2024-03-23T08:00:00.000Z",
      raw: {
        author: { id: dependabot.id },
        additions: 10,
        deletions: 2,
      },
    },
    {
      id: "repo-activity-pr-outside",
      number: 6,
      repositoryId: repository.id,
      authorId: authorA.id,
      title: "Outside Range PR",
      state: "MERGED",
      merged: true,
      createdAt: "2024-02-10T10:00:00.000Z",
      updatedAt: "2024-02-18T10:00:00.000Z",
      closedAt: "2024-02-18T10:00:00.000Z",
      mergedAt: "2024-02-18T10:00:00.000Z",
      raw: {
        author: { id: authorA.id },
        additions: 30,
        deletions: 6,
      },
    },
  ];

  for (const pr of pullRequests) {
    await upsertPullRequest(pr);
  }

  const reviews: DbReview[] = [
    {
      id: "review-alice-alpha-approved-1",
      pullRequestId: "repo-activity-pr-alpha",
      authorId: "user-alice",
      state: "APPROVED",
      submittedAt: "2024-03-10T12:00:00.000Z",
      raw: {},
    },
    {
      id: "review-alice-alpha-comment",
      pullRequestId: "repo-activity-pr-alpha",
      authorId: "user-alice",
      state: "COMMENTED",
      submittedAt: "2024-03-11T08:00:00.000Z",
      raw: {},
    },
    {
      id: "review-alice-beta-approved",
      pullRequestId: "repo-activity-pr-beta",
      authorId: "user-alice",
      state: "APPROVED",
      submittedAt: "2024-03-18T13:00:00.000Z",
      raw: {},
    },
    {
      id: "review-alice-alpha-approved-2",
      pullRequestId: "repo-activity-pr-alpha",
      authorId: "user-alice",
      state: "APPROVED",
      submittedAt: "2024-03-12T09:30:00.000Z",
      raw: {},
    },
    {
      id: "review-alice-dependabot-approved",
      pullRequestId: "repo-activity-pr-dependabot",
      authorId: "user-alice",
      state: "APPROVED",
      submittedAt: "2024-03-22T09:00:00.000Z",
      raw: {},
    },
    {
      id: "review-alice-outside-approved",
      pullRequestId: "repo-activity-pr-outside",
      authorId: "user-alice",
      state: "APPROVED",
      submittedAt: "2024-02-15T10:00:00.000Z",
      raw: {},
    },
    {
      id: "review-brad-beta-changes",
      pullRequestId: "repo-activity-pr-beta",
      authorId: "user-brad",
      state: "CHANGES_REQUESTED",
      submittedAt: "2024-03-18T14:30:00.000Z",
      raw: {},
    },
    {
      id: "review-brad-gamma-approved",
      pullRequestId: "repo-activity-pr-gamma",
      authorId: "user-brad",
      state: "APPROVED",
      submittedAt: "2024-03-19T15:45:00.000Z",
      raw: {},
    },
    {
      id: "review-brad-beta-dismissed",
      pullRequestId: "repo-activity-pr-beta",
      authorId: "user-brad",
      state: "DISMISSED",
      submittedAt: "2024-03-18T16:00:00.000Z",
      raw: {},
    },
    {
      id: "review-diana-delta-approved",
      pullRequestId: "repo-activity-pr-delta",
      authorId: "user-diana",
      state: "APPROVED",
      submittedAt: "2024-03-26T09:30:00.000Z",
      raw: {},
    },
    {
      id: "review-diana-delta-comment",
      pullRequestId: "repo-activity-pr-delta",
      authorId: "user-diana",
      state: "COMMENTED",
      submittedAt: "2024-03-26T10:15:00.000Z",
      raw: {},
    },
    {
      id: "review-chris-alpha-comment",
      pullRequestId: "repo-activity-pr-alpha",
      authorId: "user-chris",
      state: "COMMENTED",
      submittedAt: "2024-03-12T10:15:00.000Z",
      raw: {},
    },
    {
      id: "review-chris-delta-dismissed",
      pullRequestId: "repo-activity-pr-delta",
      authorId: "user-chris",
      state: "DISMISSED",
      submittedAt: "2024-03-26T11:00:00.000Z",
      raw: {},
    },
  ];

  for (const review of reviews) {
    await upsertReview(review);
  }
}

describe("analytics reviewer activity leaderboards", () => {
  beforeEach(async () => {
    await resetDashboardTables();
    await seedReviewerActivityScenario();
  });

  it("aggregates reviewer activity counts with profiles", async () => {
    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const reviewers = analytics.organization.reviewers;

    expect(reviewers.map((reviewer) => reviewer.reviewerId)).toEqual([
      "user-alice",
      "user-brad",
      "user-diana",
      "user-chris",
    ]);

    const alice = reviewers[0];
    expect(alice.reviewCount).toBe(4);
    expect(alice.pullRequestsReviewed).toBe(2);
    expect(alice.activeReviewCount).toBe(2);
    expect(alice.profile?.login).toBe("alice");

    const brad = reviewers[1];
    expect(brad.reviewCount).toBe(2);
    expect(brad.pullRequestsReviewed).toBe(2);
    expect(brad.activeReviewCount).toBe(1);

    const diana = reviewers[2];
    expect(diana.reviewCount).toBe(2);
    expect(diana.pullRequestsReviewed).toBe(1);
    expect(diana.activeReviewCount).toBe(1);

    const chris = reviewers[3];
    expect(chris.reviewCount).toBe(1);
    expect(chris.pullRequestsReviewed).toBe(1);
    expect(chris.activeReviewCount).toBe(0);
  });

  it("builds the active reviewer leaderboard using approved reviews only", async () => {
    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const leaderboard = analytics.leaderboard.activeReviewerActivity;

    expect(leaderboard.map((entry) => entry.user.id)).toEqual([
      "user-alice",
      "user-brad",
      "user-diana",
    ]);

    expect(leaderboard[0]?.value).toBe(2);
    expect(leaderboard[1]?.value).toBe(1);
    expect(leaderboard[2]?.value).toBe(1);

    expect(leaderboard[1]?.user.login).toBe("brad");
    expect(leaderboard[2]?.user.login).toBe("diana");

    expect(
      leaderboard.find((entry) => entry.user.id === "user-chris"),
    ).toBeUndefined();
  });
});
