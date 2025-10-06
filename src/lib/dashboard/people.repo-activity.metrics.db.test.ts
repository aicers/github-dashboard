// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  resetDashboardTables,
  seedPersonAndRepo,
  shiftHours,
} from "../../../tests/helpers/dashboard-metrics";

describe("people repo activity comparison", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("aggregates per-repository contributions for the selected person", async () => {
    const { actor } = await seedPersonAndRepo();

    const repoAlpha: DbRepository = {
      id: "repo-alpha",
      name: "alpha",
      nameWithOwner: "octo/alpha",
      ownerId: actor.id,
      raw: { id: "repo-alpha" },
    };
    const repoBeta: DbRepository = {
      id: "repo-beta",
      name: "beta",
      nameWithOwner: "octo/beta",
      ownerId: actor.id,
      raw: { id: "repo-beta" },
    };

    await Promise.all([
      upsertRepository(repoAlpha),
      upsertRepository(repoBeta),
    ]);

    const collaboratorAlpha: DbActor = {
      id: "collab-alpha",
      login: "collab-alpha",
      name: "Collaborator Alpha",
    };
    const reviewerAlphaOne: DbActor = {
      id: "reviewer-alpha-1",
      login: "reviewer-one",
      name: "Reviewer One",
    };
    const reviewerAlphaTwo: DbActor = {
      id: "reviewer-alpha-2",
      login: "reviewer-two",
      name: "Reviewer Two",
    };
    const betaAuthorOne: DbActor = {
      id: "beta-author-1",
      login: "beta-author-1",
      name: "Beta Author One",
    };
    const betaAuthorTwo: DbActor = {
      id: "beta-author-2",
      login: "beta-author-2",
      name: "Beta Author Two",
    };

    await Promise.all(
      [
        collaboratorAlpha,
        reviewerAlphaOne,
        reviewerAlphaTwo,
        betaAuthorOne,
        betaAuthorTwo,
      ].map((user) => upsertUser(user)),
    );

    const alphaIssueOneCreated = shiftHours(CURRENT_RANGE_START, 1);
    const alphaIssueOneClosed = shiftHours(alphaIssueOneCreated, 24);
    const alphaIssueTwoCreated = shiftHours(CURRENT_RANGE_START, 5);

    const alphaIssues: DbIssue[] = [
      {
        id: "alpha-issue-1",
        number: 101,
        repositoryId: repoAlpha.id,
        authorId: actor.id,
        title: "Alpha issue one",
        state: "CLOSED",
        createdAt: alphaIssueOneCreated,
        updatedAt: alphaIssueOneClosed,
        closedAt: alphaIssueOneClosed,
        raw: { id: "alpha-issue-1" },
      },
      {
        id: "alpha-issue-2",
        number: 102,
        repositoryId: repoAlpha.id,
        authorId: actor.id,
        title: "Alpha issue two",
        state: "OPEN",
        createdAt: alphaIssueTwoCreated,
        updatedAt: shiftHours(alphaIssueTwoCreated, 2),
        closedAt: null,
        raw: { id: "alpha-issue-2" },
      },
    ];

    for (const issue of alphaIssues) {
      await upsertIssue(issue);
    }

    const prAlphaAuthoredMergedAt = shiftHours(alphaIssueOneCreated, 10);
    const prAlphaSecondCreated = shiftHours(CURRENT_RANGE_START, 12);
    const prAlphaMergedByActorCreated = shiftHours(CURRENT_RANGE_START, 20);

    const alphaPullRequests: DbPullRequest[] = [
      {
        id: "alpha-pr-authored-merged",
        number: 201,
        repositoryId: repoAlpha.id,
        authorId: actor.id,
        title: "Alpha PR merged",
        state: "MERGED",
        createdAt: alphaIssueOneCreated,
        updatedAt: prAlphaAuthoredMergedAt,
        closedAt: prAlphaAuthoredMergedAt,
        mergedAt: prAlphaAuthoredMergedAt,
        merged: true,
        raw: {
          id: "alpha-pr-authored-merged",
          mergedBy: { id: "non-actor-merger" },
        },
      },
      {
        id: "alpha-pr-authored-open",
        number: 202,
        repositoryId: repoAlpha.id,
        authorId: actor.id,
        title: "Alpha PR open",
        state: "OPEN",
        createdAt: prAlphaSecondCreated,
        updatedAt: prAlphaSecondCreated,
        closedAt: null,
        mergedAt: null,
        merged: false,
        raw: { id: "alpha-pr-authored-open" },
      },
      {
        id: "alpha-pr-merged-by-actor",
        number: 203,
        repositoryId: repoAlpha.id,
        authorId: collaboratorAlpha.id,
        title: "Alpha PR merged by actor",
        state: "MERGED",
        createdAt: prAlphaMergedByActorCreated,
        updatedAt: shiftHours(prAlphaMergedByActorCreated, 5),
        closedAt: shiftHours(prAlphaMergedByActorCreated, 5),
        mergedAt: shiftHours(prAlphaMergedByActorCreated, 5),
        merged: true,
        raw: {
          id: "alpha-pr-merged-by-actor",
          mergedBy: { id: actor.id },
        },
      },
      {
        id: "alpha-pr-review-target",
        number: 204,
        repositoryId: repoAlpha.id,
        authorId: collaboratorAlpha.id,
        title: "Alpha PR for review",
        state: "OPEN",
        createdAt: shiftHours(CURRENT_RANGE_START, 18),
        updatedAt: shiftHours(CURRENT_RANGE_START, 18),
        closedAt: null,
        mergedAt: null,
        merged: false,
        raw: { id: "alpha-pr-review-target" },
      },
    ];

    for (const pullRequest of alphaPullRequests) {
      await upsertPullRequest(pullRequest);
    }

    const alphaFirstReview = shiftHours(alphaIssueOneCreated, 2);
    const alphaSecondReview = shiftHours(prAlphaSecondCreated, 6);

    const alphaReviewRows: DbReview[] = [
      {
        id: "alpha-pr-authored-merged-first-review",
        pullRequestId: "alpha-pr-authored-merged",
        authorId: reviewerAlphaOne.id,
        state: "COMMENTED",
        submittedAt: alphaFirstReview,
        raw: { state: "COMMENTED" },
      },
      {
        id: "alpha-pr-authored-open-first-review",
        pullRequestId: "alpha-pr-authored-open",
        authorId: reviewerAlphaTwo.id,
        state: "APPROVED",
        submittedAt: alphaSecondReview,
        raw: { state: "APPROVED" },
      },
      {
        id: "alpha-review-approved-1",
        pullRequestId: "alpha-pr-review-target",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: shiftHours(CURRENT_RANGE_START, 18),
        raw: { state: "APPROVED" },
      },
      {
        id: "alpha-review-commented",
        pullRequestId: "alpha-pr-review-target",
        authorId: actor.id,
        state: "COMMENTED",
        submittedAt: shiftHours(CURRENT_RANGE_START, 18.5),
        raw: { state: "COMMENTED" },
      },
      {
        id: "alpha-review-approved-2",
        pullRequestId: "alpha-pr-review-target",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: shiftHours(CURRENT_RANGE_START, 19),
        raw: { state: "APPROVED" },
      },
      {
        id: "alpha-review-dismissed",
        pullRequestId: "alpha-pr-review-target",
        authorId: actor.id,
        state: "DISMISSED",
        submittedAt: shiftHours(CURRENT_RANGE_START, 19.5),
        raw: { state: "DISMISSED" },
      },
    ];

    for (const review of alphaReviewRows) {
      await upsertReview(review);
    }

    const alphaComments: DbComment[] = [
      {
        id: "alpha-comment-issue",
        issueId: "alpha-issue-1",
        pullRequestId: null,
        reviewId: null,
        authorId: actor.id,
        createdAt: shiftHours(alphaIssueOneCreated, 3),
        updatedAt: shiftHours(alphaIssueOneCreated, 3),
        raw: { body: "Issue comment" },
      },
      {
        id: "alpha-comment-review-pr",
        issueId: null,
        pullRequestId: "alpha-pr-review-target",
        reviewId: null,
        authorId: actor.id,
        createdAt: shiftHours(CURRENT_RANGE_START, 22),
        updatedAt: shiftHours(CURRENT_RANGE_START, 22),
        raw: { body: "PR comment" },
      },
      {
        id: "alpha-comment-merged-pr",
        issueId: null,
        pullRequestId: "alpha-pr-merged-by-actor",
        reviewId: null,
        authorId: actor.id,
        createdAt: shiftHours(CURRENT_RANGE_START, 23),
        updatedAt: shiftHours(CURRENT_RANGE_START, 23),
        raw: { body: "Merged PR comment" },
      },
    ];

    for (const comment of alphaComments) {
      await upsertComment(comment);
    }

    const betaPullRequests: DbPullRequest[] = [
      {
        id: "beta-pr-merged-1",
        number: 301,
        repositoryId: repoBeta.id,
        authorId: betaAuthorOne.id,
        title: "Beta PR merged 1",
        state: "MERGED",
        createdAt: shiftHours(CURRENT_RANGE_START, 30),
        updatedAt: shiftHours(CURRENT_RANGE_START, 34),
        closedAt: shiftHours(CURRENT_RANGE_START, 34),
        mergedAt: shiftHours(CURRENT_RANGE_START, 34),
        merged: true,
        raw: {
          id: "beta-pr-merged-1",
          mergedBy: { id: actor.id },
        },
      },
      {
        id: "beta-pr-merged-2",
        number: 302,
        repositoryId: repoBeta.id,
        authorId: betaAuthorTwo.id,
        title: "Beta PR merged 2",
        state: "MERGED",
        createdAt: shiftHours(CURRENT_RANGE_START, 40),
        updatedAt: shiftHours(CURRENT_RANGE_START, 42),
        closedAt: shiftHours(CURRENT_RANGE_START, 42),
        mergedAt: shiftHours(CURRENT_RANGE_START, 42),
        merged: true,
        raw: {
          id: "beta-pr-merged-2",
          mergedBy: { id: actor.id },
        },
      },
      {
        id: "beta-pr-review-target",
        number: 303,
        repositoryId: repoBeta.id,
        authorId: betaAuthorTwo.id,
        title: "Beta PR for review",
        state: "OPEN",
        createdAt: shiftHours(CURRENT_RANGE_START, 35),
        updatedAt: shiftHours(CURRENT_RANGE_START, 35),
        closedAt: null,
        mergedAt: null,
        merged: false,
        raw: { id: "beta-pr-review-target" },
      },
    ];

    for (const pullRequest of betaPullRequests) {
      await upsertPullRequest(pullRequest);
    }

    const betaReview: DbReview = {
      id: "beta-review-approved",
      pullRequestId: "beta-pr-review-target",
      authorId: actor.id,
      state: "APPROVED",
      submittedAt: shiftHours(CURRENT_RANGE_START, 36),
      raw: { state: "APPROVED" },
    };
    await upsertReview(betaReview);

    const betaComment: DbComment = {
      id: "beta-comment-pr",
      issueId: null,
      pullRequestId: "beta-pr-review-target",
      reviewId: null,
      authorId: actor.id,
      createdAt: shiftHours(CURRENT_RANGE_START, 37),
      updatedAt: shiftHours(CURRENT_RANGE_START, 37),
      raw: { body: "Beta PR comment" },
    };
    await upsertComment(betaComment);

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      personId: actor.id,
    });

    const individual = analytics.individual;
    expect(individual).not.toBeNull();
    if (!individual) {
      throw new Error("individual analytics missing");
    }

    const repoComparison = individual.repoComparison;
    expect(repoComparison.length).toBe(2);

    const repoMap = new Map(
      repoComparison.map((row) => [row.repositoryId, row]),
    );

    const alphaRow = repoMap.get(repoAlpha.id);
    expect(alphaRow).toBeDefined();
    if (!alphaRow) {
      throw new Error("Missing alpha repo row");
    }
    expect(alphaRow.repository?.nameWithOwner).toBe(repoAlpha.nameWithOwner);
    expect(alphaRow.issuesCreated).toBe(2);
    expect(alphaRow.issuesResolved).toBe(1);
    expect(alphaRow.pullRequestsCreated).toBe(2);
    expect(alphaRow.pullRequestsMerged).toBe(1);
    expect(alphaRow.pullRequestsMergedBy).toBe(1);
    expect(alphaRow.reviews).toBe(3);
    expect(alphaRow.activeReviews).toBe(2);
    expect(alphaRow.comments).toBe(3);
    expect(alphaRow.avgFirstReviewHours).not.toBeNull();
    expect(alphaRow.avgFirstReviewHours ?? 0).toBeCloseTo(4, 5);

    const betaRow = repoMap.get(repoBeta.id);
    expect(betaRow).toBeDefined();
    if (!betaRow) {
      throw new Error("Missing beta repo row");
    }
    expect(betaRow.repository?.nameWithOwner).toBe(repoBeta.nameWithOwner);
    expect(betaRow.issuesCreated).toBe(0);
    expect(betaRow.issuesResolved).toBe(0);
    expect(betaRow.pullRequestsCreated).toBe(0);
    expect(betaRow.pullRequestsMerged).toBe(0);
    expect(betaRow.pullRequestsMergedBy).toBe(2);
    expect(betaRow.reviews).toBe(1);
    expect(betaRow.activeReviews).toBe(1);
    expect(betaRow.comments).toBe(1);
    expect(betaRow.avgFirstReviewHours).toBeNull();
  });
});
