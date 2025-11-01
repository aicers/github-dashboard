// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { getAttentionInsights } from "@/lib/dashboard/attention";
import {
  differenceInBusinessDays,
  differenceInBusinessDaysOrNull,
} from "@/lib/dashboard/business-days";
import { ensureSchema } from "@/lib/db";
import {
  type DbComment,
  type DbReaction,
  updateSyncConfig,
  upsertComment,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildActor,
  buildPullRequest,
  buildRepository,
  buildReview,
  buildReviewRequest,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

describe("attention insights for stuck review requests", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    await ensureSchema();
    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: ["repo-excluded"],
      excludedUsers: ["user-excluded", "user-excluded-author"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns business-day waiting age and filters out responded or excluded review requests", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");
    const dave = buildActor("user-dave", "dave", "Dave");
    const frank = buildActor("user-frank", "frank", "Frank");
    const excludedReviewer = buildActor(
      "user-excluded",
      "excluded",
      "Excluded",
    );
    const commentReviewer = buildActor("user-erin", "erin", "Erin");
    const reviewReviewer = buildActor("user-george", "george", "George");
    const reactionReviewer = buildActor("user-harry", "harry", "Harry");
    const recentReviewer = buildActor("user-ivy", "ivy", "Ivy");
    const excludedAuthor = buildActor(
      "user-excluded-author",
      "excludedAuthor",
      "Excluded Author",
    );

    for (const actor of [
      owner,
      alice,
      bob,
      carol,
      dave,
      frank,
      excludedReviewer,
      commentReviewer,
      reviewReviewer,
      reactionReviewer,
      recentReviewer,
      excludedAuthor,
    ]) {
      await upsertUser(actor);
    }

    const mainRepo = buildRepository(
      "repo-main",
      "main",
      owner.id,
      owner.login ?? "owner",
    );
    const otherRepo = buildRepository(
      "repo-other",
      "other",
      owner.id,
      owner.login ?? "owner",
    );
    const filteredRepo = buildRepository(
      "repo-excluded",
      "filtered",
      owner.id,
      owner.login ?? "owner",
    );

    for (const repo of [mainRepo, otherRepo, filteredRepo]) {
      await upsertRepository(repo);
    }

    const targetPr = buildPullRequest({
      id: "pr-target",
      number: 401,
      repository: mainRepo,
      authorId: alice.id,
      title: "Improve dashboard responsiveness",
      url: "https://github.com/acme/main/pull/401",
      createdAt: "2024-01-10T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
    });

    const recentPr = buildPullRequest({
      id: "pr-recent",
      number: 402,
      repository: mainRepo,
      authorId: bob.id,
      title: "Recent notification tweaks",
      url: "https://github.com/acme/main/pull/402",
      createdAt: "2024-02-14T00:00:00.000Z",
      updatedAt: "2024-02-16T00:00:00.000Z",
    });

    const commentPr = buildPullRequest({
      id: "pr-comment",
      number: 403,
      repository: otherRepo,
      authorId: alice.id,
      title: "Refine comment handling",
      url: "https://github.com/acme/other/pull/403",
      createdAt: "2023-12-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });

    const reviewPr = buildPullRequest({
      id: "pr-review",
      number: 404,
      repository: otherRepo,
      authorId: alice.id,
      title: "Extend review coverage",
      url: "https://github.com/acme/other/pull/404",
      createdAt: "2023-12-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });

    const reactionPr = buildPullRequest({
      id: "pr-reaction",
      number: 405,
      repository: otherRepo,
      authorId: alice.id,
      title: "Add emoji support",
      url: "https://github.com/acme/other/pull/405",
      createdAt: "2023-12-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });

    const filteredRepoPr = buildPullRequest({
      id: "pr-filtered-repo",
      number: 406,
      repository: filteredRepo,
      authorId: alice.id,
      title: "Should be excluded by repo",
      url: "https://github.com/acme/filtered/pull/406",
      createdAt: "2023-10-01T00:00:00.000Z",
      updatedAt: "2023-12-01T00:00:00.000Z",
    });

    const excludedAuthorPr = buildPullRequest({
      id: "pr-excluded-author",
      number: 407,
      repository: mainRepo,
      authorId: excludedAuthor.id,
      title: "Hidden by excluded author",
      url: "https://github.com/acme/main/pull/407",
      createdAt: "2023-11-01T00:00:00.000Z",
    });

    const excludedReviewerPr = buildPullRequest({
      id: "pr-excluded-reviewer",
      number: 408,
      repository: mainRepo,
      authorId: alice.id,
      title: "Hidden by excluded reviewer",
      url: "https://github.com/acme/main/pull/408",
      createdAt: "2023-11-01T00:00:00.000Z",
    });

    for (const pr of [
      targetPr,
      recentPr,
      commentPr,
      reviewPr,
      reactionPr,
      filteredRepoPr,
      excludedAuthorPr,
      excludedReviewerPr,
    ]) {
      await upsertPullRequest(pr);
    }

    const carolRequest = buildReviewRequest({
      id: "rr-carol",
      pullRequestId: targetPr.id,
      reviewerId: carol.id,
      requestedAt: "2024-02-07T09:00:00.000Z",
    });

    const daveRequest = buildReviewRequest({
      id: "rr-dave",
      pullRequestId: targetPr.id,
      reviewerId: dave.id,
      requestedAt: "2024-02-08T09:00:00.000Z",
    });

    const recentRequest = buildReviewRequest({
      id: "rr-recent",
      pullRequestId: recentPr.id,
      reviewerId: recentReviewer.id,
      requestedAt: "2024-02-16T09:00:00.000Z",
    });

    const commentedRequest = buildReviewRequest({
      id: "rr-commented",
      pullRequestId: commentPr.id,
      reviewerId: commentReviewer.id,
      requestedAt: "2024-02-07T09:00:00.000Z",
    });

    const reviewedRequest = buildReviewRequest({
      id: "rr-reviewed",
      pullRequestId: reviewPr.id,
      reviewerId: reviewReviewer.id,
      requestedAt: "2024-02-07T09:00:00.000Z",
    });

    const reactedRequest = buildReviewRequest({
      id: "rr-reacted",
      pullRequestId: reactionPr.id,
      reviewerId: reactionReviewer.id,
      requestedAt: "2024-02-07T09:00:00.000Z",
    });

    const filteredRepoRequest = buildReviewRequest({
      id: "rr-excluded-repo",
      pullRequestId: filteredRepoPr.id,
      reviewerId: carol.id,
      requestedAt: "2023-12-01T09:00:00.000Z",
    });

    const excludedAuthorRequest = buildReviewRequest({
      id: "rr-excluded-author",
      pullRequestId: excludedAuthorPr.id,
      reviewerId: carol.id,
      requestedAt: "2023-12-01T09:00:00.000Z",
    });

    const excludedReviewerRequest = buildReviewRequest({
      id: "rr-excluded-reviewer",
      pullRequestId: excludedReviewerPr.id,
      reviewerId: excludedReviewer.id,
      requestedAt: "2023-12-01T09:00:00.000Z",
    });

    for (const request of [
      carolRequest,
      daveRequest,
      recentRequest,
      commentedRequest,
      reviewedRequest,
      reactedRequest,
      filteredRepoRequest,
      excludedAuthorRequest,
      excludedReviewerRequest,
    ]) {
      await upsertReviewRequest(request);
    }

    const frankReview = buildReview({
      id: "review-frank",
      pullRequestId: targetPr.id,
      authorId: frank.id,
      submittedAt: "2024-02-12T10:00:00.000Z",
      state: "COMMENTED",
    });

    const reviewerResponse = buildReview({
      id: "review-george",
      pullRequestId: reviewPr.id,
      authorId: reviewReviewer.id,
      submittedAt: "2024-02-09T10:00:00.000Z",
      state: "APPROVED",
    });

    await upsertReview(frankReview);
    await upsertReview(reviewerResponse);

    const responseComment: DbComment = {
      id: "comment-response",
      issueId: null,
      pullRequestId: commentPr.id,
      reviewId: null,
      authorId: commentReviewer.id,
      createdAt: "2024-02-09T10:00:00.000Z",
      updatedAt: "2024-02-09T10:00:00.000Z",
      raw: {
        id: "comment-response",
        pullRequestId: commentPr.id,
        authorId: commentReviewer.id,
        createdAt: "2024-02-09T10:00:00.000Z",
      },
    } satisfies DbComment;
    await upsertComment(responseComment);

    const responseReaction: DbReaction = {
      id: "reaction-response",
      subjectType: "PullRequest",
      subjectId: reactionPr.id,
      userId: reactionReviewer.id,
      content: "THUMBS_UP",
      createdAt: "2024-02-10T00:00:00.000Z",
      raw: {
        id: "reaction-response",
        subjectType: "PullRequest",
        subjectId: reactionPr.id,
        userId: reactionReviewer.id,
        createdAt: "2024-02-10T00:00:00.000Z",
      },
    } satisfies DbReaction;
    await upsertReaction(responseReaction);

    await refreshActivityItemsSnapshot({ truncate: true });

    const insights = await getAttentionInsights();

    expect(insights.timezone).toBe("Asia/Seoul");
    expect(new Date(insights.generatedAt).toISOString()).toBe(FIXED_NOW);

    expect(insights.stuckReviewRequests).toHaveLength(2);
    const stuckIds = insights.stuckReviewRequests.map((item) => item.id).sort();
    expect(stuckIds).toEqual(["rr-carol", "rr-dave"].sort());

    const carolItem = insights.stuckReviewRequests.find(
      (item) => item.id === "rr-carol",
    );
    const daveItem = insights.stuckReviewRequests.find(
      (item) => item.id === "rr-dave",
    );

    if (!carolItem || !daveItem) {
      throw new Error("Expected stuck review requests to be present");
    }

    const now = new Date(FIXED_NOW);
    const expectedCarolWaiting = differenceInBusinessDays(
      carolRequest.requestedAt,
      now,
    );
    const expectedDaveWaiting = differenceInBusinessDays(
      daveRequest.requestedAt,
      now,
    );

    expect(carolItem.waitingDays).toBe(expectedCarolWaiting);
    expect(daveItem.waitingDays).toBe(expectedDaveWaiting);

    expect(carolItem.reviewer).toEqual({
      id: carol.id,
      login: carol.login ?? null,
      name: carol.name ?? null,
    });
    expect(daveItem.reviewer).toEqual({
      id: dave.id,
      login: dave.login ?? null,
      name: dave.name ?? null,
    });

    const expectedPrAgeRaw = differenceInBusinessDays(targetPr.createdAt, now);
    const expectedPrAge =
      expectedPrAgeRaw === 0 ? expectedCarolWaiting : expectedPrAgeRaw;
    const expectedPrInactivity = differenceInBusinessDaysOrNull(
      targetPr.updatedAt,
      now,
    );

    expect(carolItem.pullRequestAgeDays).toBe(expectedPrAge);
    expect(carolItem.pullRequestInactivityDays).toBe(expectedPrInactivity);

    expect(carolItem.pullRequest.id).toBe(targetPr.id);
    expect(carolItem.pullRequest.number).toBe(401);
    expect(carolItem.pullRequest.title).toBe(
      "Improve dashboard responsiveness",
    );
    expect(carolItem.pullRequest.url).toBe(
      "https://github.com/acme/main/pull/401",
    );
    expect(carolItem.pullRequest.author).toEqual({
      id: alice.id,
      login: alice.login ?? null,
      name: alice.name ?? null,
    });

    const reviewerIds = carolItem.pullRequest.reviewers.map((reviewer) => {
      return reviewer.id;
    });
    expect(new Set(reviewerIds)).toEqual(
      new Set([carol.id, dave.id, frank.id]),
    );

    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === recentPr.id,
      ),
    ).toBe(false);
    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === commentPr.id,
      ),
    ).toBe(false);
    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === reviewPr.id,
      ),
    ).toBe(false);
    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === reactionPr.id,
      ),
    ).toBe(false);
    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === filteredRepoPr.id,
      ),
    ).toBe(false);
    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === excludedAuthorPr.id,
      ),
    ).toBe(false);
    expect(
      insights.stuckReviewRequests.some(
        (item) => item.pullRequest.id === excludedReviewerPr.id,
      ),
    ).toBe(false);
  });
});
