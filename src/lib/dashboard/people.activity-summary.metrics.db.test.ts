// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbReview,
  type DbReviewRequest,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  resetDashboardTables,
  seedPersonAndRepo,
  shiftHours,
} from "../../../tests/helpers/people-metrics";

describe("people activity summary metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("aggregates individual metrics used by the activity summary", async () => {
    const { actor, repository } = await seedPersonAndRepo();

    const teammate: DbActor = {
      id: "teammate-actor",
      login: "teammate",
      name: "Teammate",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "reviewer-actor",
      login: "reviewer",
      name: "Reviewer",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };

    await upsertUser(teammate);
    await upsertUser(reviewer);

    const parentCreatedAt = shiftHours(CURRENT_RANGE_START, 1);
    const parentClosedAt = shiftHours(parentCreatedAt, 72);
    const parentIssue: DbIssue = {
      id: "issue-parent",
      number: 1,
      repositoryId: repository.id,
      authorId: actor.id,
      title: "Parent issue",
      state: "CLOSED",
      createdAt: parentCreatedAt,
      updatedAt: parentClosedAt,
      closedAt: parentClosedAt,
      raw: {
        trackedIssues: { totalCount: 1 },
        trackedInIssues: { totalCount: 0 },
        projectStatusHistory: [
          {
            projectTitle: "To-Do List",
            status: "In Progress",
            occurredAt: shiftHours(parentClosedAt, -36),
          },
          {
            projectTitle: "To-Do List",
            status: "Done",
            occurredAt: parentClosedAt,
          },
        ],
      },
    };

    const childCreatedAt = shiftHours(CURRENT_RANGE_START, 5);
    const childClosedAt = shiftHours(childCreatedAt, 48);
    const childIssue: DbIssue = {
      id: "issue-child",
      number: 2,
      repositoryId: repository.id,
      authorId: actor.id,
      title: "Child issue",
      state: "CLOSED",
      createdAt: childCreatedAt,
      updatedAt: childClosedAt,
      closedAt: childClosedAt,
      raw: {
        trackedIssues: { totalCount: 0 },
        trackedInIssues: { totalCount: 1 },
        projectStatusHistory: [
          {
            projectTitle: "To-Do List",
            status: "In Progress",
            occurredAt: shiftHours(childClosedAt, -24),
          },
          {
            projectTitle: "To-Do List",
            status: "Done",
            occurredAt: childClosedAt,
          },
        ],
      },
    };

    await upsertIssue(parentIssue);
    await upsertIssue(childIssue);

    const actorPrCreatedAt = shiftHours(CURRENT_RANGE_START, 12);
    const actorPrMergedAt = shiftHours(actorPrCreatedAt, 24);
    const actorPullRequest: DbPullRequest = {
      id: "actor-pr-1",
      number: 101,
      repositoryId: repository.id,
      authorId: actor.id,
      title: "Actor PR",
      state: "MERGED",
      createdAt: actorPrCreatedAt,
      updatedAt: actorPrMergedAt,
      closedAt: actorPrMergedAt,
      mergedAt: actorPrMergedAt,
      merged: true,
      raw: {
        mergedBy: { id: teammate.id },
      },
    };

    const teammateMergedPrCreatedAt = shiftHours(CURRENT_RANGE_START, 18);
    const teammateMergedPrMergedAt = shiftHours(teammateMergedPrCreatedAt, 6);
    const teammateMergedPullRequest: DbPullRequest = {
      id: "teammate-pr-merged",
      number: 102,
      repositoryId: repository.id,
      authorId: teammate.id,
      title: "Teammate PR merged by actor",
      state: "MERGED",
      createdAt: teammateMergedPrCreatedAt,
      updatedAt: teammateMergedPrMergedAt,
      closedAt: teammateMergedPrMergedAt,
      mergedAt: teammateMergedPrMergedAt,
      merged: true,
      raw: {
        mergedBy: { id: actor.id },
      },
    };

    const reviewPrCreatedAt = shiftHours(CURRENT_RANGE_START, 30);
    const reviewPrMergedAt = shiftHours(reviewPrCreatedAt, 12);
    const reviewTargetPullRequest: DbPullRequest = {
      id: "teammate-pr-review",
      number: 103,
      repositoryId: repository.id,
      authorId: teammate.id,
      title: "Teammate PR for review",
      state: "MERGED",
      createdAt: reviewPrCreatedAt,
      updatedAt: reviewPrMergedAt,
      closedAt: reviewPrMergedAt,
      mergedAt: reviewPrMergedAt,
      merged: true,
      raw: {
        mergedBy: { id: teammate.id },
      },
    };

    await upsertPullRequest(actorPullRequest);
    await upsertPullRequest(teammateMergedPullRequest);
    await upsertPullRequest(reviewTargetPullRequest);

    const feedbackReviewOne: DbReview = {
      id: "feedback-review-1",
      pullRequestId: actorPullRequest.id,
      authorId: teammate.id,
      state: "COMMENTED",
      submittedAt: shiftHours(actorPrCreatedAt, 6),
      raw: {},
    };
    const feedbackReviewTwo: DbReview = {
      id: "feedback-review-2",
      pullRequestId: actorPullRequest.id,
      authorId: reviewer.id,
      state: "CHANGES_REQUESTED",
      submittedAt: shiftHours(actorPrCreatedAt, 8),
      raw: {},
    };

    await upsertReview(feedbackReviewOne);
    await upsertReview(feedbackReviewTwo);

    const reviewRequest: DbReviewRequest = {
      id: "review-request-1",
      pullRequestId: reviewTargetPullRequest.id,
      reviewerId: actor.id,
      requestedAt: shiftHours(reviewPrCreatedAt, 2),
      raw: {},
    };
    await upsertReviewRequest(reviewRequest);

    const actorReviewComment: DbReview = {
      id: "actor-review-comment",
      pullRequestId: reviewTargetPullRequest.id,
      authorId: actor.id,
      state: "COMMENTED",
      submittedAt: shiftHours(reviewPrCreatedAt, 6),
      raw: {},
    };
    const actorReviewApproved: DbReview = {
      id: "actor-review-approved",
      pullRequestId: reviewTargetPullRequest.id,
      authorId: actor.id,
      state: "APPROVED",
      submittedAt: shiftHours(reviewPrCreatedAt, 9),
      raw: {},
    };

    await upsertReview(actorReviewComment);
    await upsertReview(actorReviewApproved);

    const actorDiscussionComment: DbComment = {
      id: "actor-comment-1",
      issueId: null,
      pullRequestId: reviewTargetPullRequest.id,
      reviewId: null,
      authorId: actor.id,
      createdAt: shiftHours(reviewPrCreatedAt, 7),
      updatedAt: shiftHours(reviewPrCreatedAt, 7),
      raw: {},
    };

    await upsertComment(actorDiscussionComment);

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      personId: actor.id,
    });

    const individual = analytics.individual;
    expect(individual).not.toBeNull();
    if (!individual) {
      throw new Error("Expected individual analytics for seeded actor");
    }

    const metrics = individual.metrics;

    expect(metrics.issuesCreated.current).toBe(2);
    expect(metrics.issuesClosed.current).toBe(2);

    expect(metrics.issueResolutionTime.unit).toBe("hours");
    expect(metrics.issueResolutionTime.current).toBeCloseTo(60, 5);

    expect(metrics.issueWorkTime.unit).toBe("hours");
    expect(metrics.issueWorkTime.current).toBeCloseTo(30, 5);

    expect(metrics.parentIssueResolutionTime.unit).toBe("hours");
    expect(metrics.parentIssueResolutionTime.current).toBeCloseTo(72, 5);

    expect(metrics.parentIssueWorkTime.unit).toBe("hours");
    expect(metrics.parentIssueWorkTime.current).toBeCloseTo(36, 5);

    expect(metrics.childIssueResolutionTime.unit).toBe("hours");
    expect(metrics.childIssueResolutionTime.current).toBeCloseTo(48, 5);

    expect(metrics.childIssueWorkTime.unit).toBe("hours");
    expect(metrics.childIssueWorkTime.current).toBeCloseTo(24, 5);

    expect(metrics.prsCreated.current).toBe(1);
    expect(metrics.prsMerged.current).toBe(1);
    expect(metrics.prsMergedBy.current).toBe(1);

    expect(metrics.prCompleteness.current).toBeCloseTo(2, 5);

    expect(metrics.reviewsCompleted.current).toBe(2);
    expect(metrics.activeReviewsCompleted.current).toBe(1);

    expect(metrics.reviewResponseTime.unit).toBe("hours");
    expect(metrics.reviewResponseTime.current).toBeCloseTo(4, 5);

    expect(metrics.prsReviewed.current).toBe(1);
    expect(metrics.reviewComments.current).toBe(1);

    expect(metrics.reviewCoverage.current).toBeCloseTo(1 / 3, 5);
    expect(metrics.reviewParticipation.current).toBeCloseTo(1, 5);

    expect(metrics.discussionComments.current).toBe(1);
  });
});
