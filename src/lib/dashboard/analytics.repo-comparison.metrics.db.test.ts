import "../../../tests/helpers/postgres-container";
import "@testing-library/jest-dom";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  updateSyncConfig,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import { ensureSchema } from "@/lib/db/schema";

const RANGE_START = "2024-05-01T00:00:00.000Z";
const RANGE_END = "2024-05-31T23:59:59.999Z";

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

describe("analytics repository comparison", () => {
  beforeEach(async () => {
    await ensureSchema();
    await query(
      "TRUNCATE TABLE comments, reviews, review_requests, pull_requests, issues, reactions, repositories, users RESTART IDENTITY CASCADE",
    );
    await query("TRUNCATE TABLE sync_log, sync_state RESTART IDENTITY CASCADE");
    await updateSyncConfig({
      timezone: "UTC",
      excludedRepositories: [],
      excludedUsers: [],
    });
  });

  it("aggregates repository metrics with DB-backed events", async () => {
    const repositoryAlpha: DbRepository = {
      id: "repo-alpha",
      name: "alpha",
      nameWithOwner: "octo/alpha",
      raw: { id: "repo-alpha" },
    };
    const repositoryBeta: DbRepository = {
      id: "repo-beta",
      name: "beta",
      nameWithOwner: "octo/beta",
      raw: { id: "repo-beta" },
    };
    const repositoryGamma: DbRepository = {
      id: "repo-gamma",
      name: "gamma",
      nameWithOwner: "octo/gamma",
      raw: { id: "repo-gamma" },
    };

    await seedRepositories([repositoryAlpha, repositoryBeta, repositoryGamma]);

    const authorAlpha: DbActor = {
      id: "user-author-alpha",
      login: "author-alpha",
      name: "Author Alpha",
    };
    const authorBeta: DbActor = {
      id: "user-author-beta",
      login: "author-beta",
      name: "Author Beta",
    };
    const authorGamma: DbActor = {
      id: "user-author-gamma",
      login: "author-gamma",
      name: "Author Gamma",
    };
    const reviewerOne: DbActor = {
      id: "user-reviewer-1",
      login: "reviewer-one",
      name: "Reviewer One",
    };
    const reviewerTwo: DbActor = {
      id: "user-reviewer-2",
      login: "reviewer-two",
      name: "Reviewer Two",
    };
    const commenter: DbActor = {
      id: "user-commenter",
      login: "commenter",
      name: "Commenter",
    };

    await seedUsers([
      authorAlpha,
      authorBeta,
      authorGamma,
      reviewerOne,
      reviewerTwo,
      commenter,
    ]);

    const issues: DbIssue[] = [
      {
        id: "issue-alpha-1",
        number: 1,
        repositoryId: repositoryAlpha.id,
        authorId: authorAlpha.id,
        title: "Alpha issue one",
        state: "CLOSED",
        createdAt: "2024-05-05T08:00:00.000Z",
        updatedAt: "2024-05-07T10:00:00.000Z",
        closedAt: "2024-05-07T10:00:00.000Z",
        raw: { id: "issue-alpha-1" },
      },
      {
        id: "issue-alpha-2",
        number: 2,
        repositoryId: repositoryAlpha.id,
        authorId: authorAlpha.id,
        title: "Alpha issue two",
        state: "CLOSED",
        createdAt: "2024-05-10T09:00:00.000Z",
        updatedAt: "2024-05-11T11:00:00.000Z",
        closedAt: "2024-05-11T11:00:00.000Z",
        raw: { id: "issue-alpha-2" },
      },
      {
        id: "issue-beta-1",
        number: 1,
        repositoryId: repositoryBeta.id,
        authorId: authorBeta.id,
        title: "Beta issue",
        state: "CLOSED",
        createdAt: "2024-05-08T03:30:00.000Z",
        updatedAt: "2024-05-09T02:00:00.000Z",
        closedAt: "2024-05-09T02:00:00.000Z",
        raw: { id: "issue-beta-1" },
      },
    ];

    for (const issue of issues) {
      await upsertIssue(issue);
    }

    const pullRequests: DbPullRequest[] = [
      {
        id: "pr-alpha-1",
        number: 10,
        repositoryId: repositoryAlpha.id,
        authorId: authorAlpha.id,
        title: "Alpha PR one",
        state: "MERGED",
        merged: true,
        createdAt: "2024-05-06T00:00:00.000Z",
        updatedAt: "2024-05-08T15:00:00.000Z",
        closedAt: "2024-05-08T15:00:00.000Z",
        mergedAt: "2024-05-08T15:00:00.000Z",
        raw: {
          id: "pr-alpha-1",
          mergedBy: { id: reviewerOne.id },
        },
      },
      {
        id: "pr-alpha-2",
        number: 11,
        repositoryId: repositoryAlpha.id,
        authorId: authorAlpha.id,
        title: "Alpha PR two",
        state: "MERGED",
        merged: true,
        createdAt: "2024-05-07T00:00:00.000Z",
        updatedAt: "2024-05-09T12:00:00.000Z",
        closedAt: "2024-05-09T12:00:00.000Z",
        mergedAt: "2024-05-09T12:00:00.000Z",
        raw: {
          id: "pr-alpha-2",
          mergedBy: { id: reviewerTwo.id },
        },
      },
      {
        id: "pr-beta-1",
        number: 20,
        repositoryId: repositoryBeta.id,
        authorId: authorBeta.id,
        title: "Beta PR",
        state: "OPEN",
        merged: false,
        createdAt: "2024-05-09T00:00:00.000Z",
        updatedAt: "2024-05-09T06:00:00.000Z",
        raw: { id: "pr-beta-1" },
      },
      {
        id: "pr-gamma-1",
        number: 30,
        repositoryId: repositoryGamma.id,
        authorId: authorGamma.id,
        title: "Gamma PR",
        state: "OPEN",
        merged: false,
        createdAt: "2024-05-10T01:00:00.000Z",
        updatedAt: "2024-05-10T01:00:00.000Z",
        raw: { id: "pr-gamma-1" },
      },
    ];

    for (const pullRequest of pullRequests) {
      await upsertPullRequest(pullRequest);
    }

    const reviews: DbReview[] = [
      {
        id: "review-alpha-1",
        pullRequestId: "pr-alpha-1",
        authorId: reviewerOne.id,
        state: "APPROVED",
        submittedAt: "2024-05-06T12:00:00.000Z",
        raw: { id: "review-alpha-1" },
      },
      {
        id: "review-alpha-2",
        pullRequestId: "pr-alpha-1",
        authorId: reviewerTwo.id,
        state: "COMMENTED",
        submittedAt: "2024-05-06T15:00:00.000Z",
        raw: { id: "review-alpha-2" },
      },
      {
        id: "review-alpha-3",
        pullRequestId: "pr-alpha-2",
        authorId: reviewerOne.id,
        state: "APPROVED",
        submittedAt: "2024-05-07T06:00:00.000Z",
        raw: { id: "review-alpha-3" },
      },
      {
        id: "review-beta-1",
        pullRequestId: "pr-beta-1",
        authorId: reviewerTwo.id,
        state: "COMMENTED",
        submittedAt: "2024-05-09T03:00:00.000Z",
        raw: { id: "review-beta-1" },
      },
    ];

    for (const review of reviews) {
      await upsertReview(review);
    }

    const comments: DbComment[] = [
      {
        id: "comment-alpha-issue",
        issueId: "issue-alpha-1",
        authorId: commenter.id,
        createdAt: "2024-05-06T10:00:00.000Z",
        updatedAt: "2024-05-06T10:00:00.000Z",
        raw: { id: "comment-alpha-issue" },
      },
      {
        id: "comment-alpha-pr-1",
        pullRequestId: "pr-alpha-1",
        authorId: reviewerOne.id,
        createdAt: "2024-05-06T11:00:00.000Z",
        updatedAt: "2024-05-06T11:00:00.000Z",
        raw: { id: "comment-alpha-pr-1" },
      },
      {
        id: "comment-alpha-pr-2",
        pullRequestId: "pr-alpha-2",
        authorId: reviewerTwo.id,
        createdAt: "2024-05-07T08:00:00.000Z",
        updatedAt: "2024-05-07T08:00:00.000Z",
        raw: { id: "comment-alpha-pr-2" },
      },
      {
        id: "comment-beta-issue",
        issueId: "issue-beta-1",
        authorId: commenter.id,
        createdAt: "2024-05-08T05:00:00.000Z",
        updatedAt: "2024-05-08T05:00:00.000Z",
        raw: { id: "comment-beta-issue" },
      },
      {
        id: "comment-beta-pr",
        pullRequestId: "pr-beta-1",
        authorId: reviewerTwo.id,
        createdAt: "2024-05-09T04:00:00.000Z",
        updatedAt: "2024-05-09T04:00:00.000Z",
        raw: { id: "comment-beta-pr" },
      },
    ];

    for (const comment of comments) {
      await upsertComment(comment);
    }

    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const rows = analytics.organization.repoComparison;
    expect(rows).toHaveLength(3);

    const rowById = new Map(rows.map((row) => [row.repositoryId, row]));

    const alphaRow = rowById.get(repositoryAlpha.id);
    expect(alphaRow).toBeDefined();
    expect(alphaRow?.repository?.nameWithOwner).toBe("octo/alpha");
    expect(alphaRow?.issuesCreated).toBe(2);
    expect(alphaRow?.issuesResolved).toBe(2);
    expect(alphaRow?.pullRequestsCreated).toBe(2);
    expect(alphaRow?.pullRequestsMerged).toBe(2);
    expect(alphaRow?.pullRequestsMergedBy).toBe(2);
    expect(alphaRow?.reviews).toBe(3);
    expect(alphaRow?.activeReviews).toBe(2);
    expect(alphaRow?.comments).toBe(3);
    expect(alphaRow?.avgFirstReviewHours).toBeCloseTo(9, 5);

    const betaRow = rowById.get(repositoryBeta.id);
    expect(betaRow).toBeDefined();
    expect(betaRow?.repository?.nameWithOwner).toBe("octo/beta");
    expect(betaRow?.issuesCreated).toBe(1);
    expect(betaRow?.issuesResolved).toBe(1);
    expect(betaRow?.pullRequestsCreated).toBe(1);
    expect(betaRow?.pullRequestsMerged).toBe(0);
    expect(betaRow?.pullRequestsMergedBy).toBe(0);
    expect(betaRow?.reviews).toBe(1);
    expect(betaRow?.activeReviews).toBe(0);
    expect(betaRow?.comments).toBe(2);
    expect(betaRow?.avgFirstReviewHours).toBeCloseTo(3, 5);

    const gammaRow = rowById.get(repositoryGamma.id);
    expect(gammaRow).toBeDefined();
    expect(gammaRow?.repository?.nameWithOwner).toBe("octo/gamma");
    expect(gammaRow?.issuesCreated).toBe(0);
    expect(gammaRow?.issuesResolved).toBe(0);
    expect(gammaRow?.pullRequestsCreated).toBe(1);
    expect(gammaRow?.pullRequestsMerged).toBe(0);
    expect(gammaRow?.pullRequestsMergedBy).toBe(0);
    expect(gammaRow?.reviews).toBe(0);
    expect(gammaRow?.activeReviews).toBe(0);
    expect(gammaRow?.comments).toBe(0);
    expect(gammaRow?.avgFirstReviewHours).toBeNull();
  });
});
