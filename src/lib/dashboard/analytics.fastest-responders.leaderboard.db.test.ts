// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbComment,
  type DbPullRequest,
  type DbReaction,
  type DbRepository,
  type DbReview,
  type DbReviewRequest,
  markReviewRequestRemoved,
  upsertComment,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";

const RANGE_START = "2024-05-01T00:00:00.000Z";
const RANGE_END = "2024-05-31T23:59:59.999Z";

async function resetDatabase() {
  await query(
    "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users RESTART IDENTITY CASCADE",
  );
}

function buildActor(id: string, login: string, name?: string): DbActor {
  return {
    id,
    login,
    name: name ?? login,
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  };
}

function createPullRequest(params: {
  id: string;
  number: number;
  repository: DbRepository;
  authorId: string;
  createdAt: string;
  mergedAt: string;
}): DbPullRequest {
  const { id, number, repository, authorId, createdAt, mergedAt } = params;
  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title: `${repository.name} #${number}`,
    state: "MERGED",
    createdAt,
    updatedAt: mergedAt,
    closedAt: mergedAt,
    mergedAt,
    merged: true,
    raw: {
      id,
      author: { id: authorId },
      mergedAt,
    },
  } satisfies DbPullRequest;
}

function createReviewRequest(params: {
  id: string;
  pullRequestId: string;
  reviewerId: string;
  requestedAt: string;
}): DbReviewRequest {
  const { id, pullRequestId, reviewerId, requestedAt } = params;
  return {
    id,
    pullRequestId,
    reviewerId,
    requestedAt,
    raw: {
      id,
      pullRequestId,
      reviewerId,
      requestedAt,
    },
  } satisfies DbReviewRequest;
}

function createReview(params: {
  id: string;
  pullRequestId: string;
  authorId: string;
  submittedAt: string;
}): DbReview {
  const { id, pullRequestId, authorId, submittedAt } = params;
  return {
    id,
    pullRequestId,
    authorId,
    state: "COMMENTED",
    submittedAt,
    raw: {
      id,
      pullRequestId,
      authorId,
      submittedAt,
    },
  } satisfies DbReview;
}

function createComment(params: {
  id: string;
  pullRequestId: string;
  authorId: string;
  createdAt: string;
}): DbComment {
  const { id, pullRequestId, authorId, createdAt } = params;
  return {
    id,
    pullRequestId,
    authorId,
    createdAt,
    updatedAt: createdAt,
    raw: {
      id,
      pullRequestId,
      authorId,
      createdAt,
    },
  } satisfies DbComment;
}

function createReaction(params: {
  id: string;
  pullRequestId: string;
  userId: string;
  createdAt: string;
}): DbReaction {
  const { id, pullRequestId, userId, createdAt } = params;
  return {
    id,
    subjectType: "pull_request",
    subjectId: pullRequestId,
    userId,
    content: "THUMBS_UP",
    createdAt,
    raw: {
      id,
      pullRequestId,
      userId,
      createdAt,
    },
  } satisfies DbReaction;
}

describe("analytics leaderboard fastest responders", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("ranks reviewers by average response time across response types", async () => {
    const owner = buildActor("user-owner", "owner");
    const author = buildActor("user-author", "author", "Author");
    const fast = buildActor("user-fast", "fast", "Fast Reviewer");
    const slow = buildActor("user-slow", "slow", "Slow Reviewer");
    const reactor = buildActor("user-reactor", "reactor", "Reaction Reviewer");
    const idle = buildActor("user-idle", "idle", "Idle Reviewer");

    for (const actor of [owner, author, fast, slow, reactor, idle]) {
      await upsertUser(actor);
    }

    const repo: DbRepository = {
      id: "repo-analytics",
      name: "analytics",
      nameWithOwner: "octo/analytics",
      ownerId: owner.id,
      raw: { id: "repo-analytics" },
    } satisfies DbRepository;
    await upsertRepository(repo);

    const prAlpha = createPullRequest({
      id: "pr-alpha",
      number: 1,
      repository: repo,
      authorId: author.id,
      createdAt: "2024-05-02T08:00:00.000Z",
      mergedAt: "2024-05-04T08:00:00.000Z",
    });
    const prBeta = createPullRequest({
      id: "pr-beta",
      number: 2,
      repository: repo,
      authorId: author.id,
      createdAt: "2024-05-06T08:30:00.000Z",
      mergedAt: "2024-05-07T16:00:00.000Z",
    });
    const prGamma = createPullRequest({
      id: "pr-gamma",
      number: 3,
      repository: repo,
      authorId: author.id,
      createdAt: "2024-05-08T08:00:00.000Z",
      mergedAt: "2024-05-09T18:00:00.000Z",
    });
    const prDelta = createPullRequest({
      id: "pr-delta",
      number: 4,
      repository: repo,
      authorId: author.id,
      createdAt: "2024-05-10T07:30:00.000Z",
      mergedAt: "2024-05-11T12:00:00.000Z",
    });

    for (const pr of [prAlpha, prBeta, prGamma, prDelta]) {
      await upsertPullRequest(pr);
    }

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-fast-1",
        pullRequestId: prAlpha.id,
        reviewerId: fast.id,
        requestedAt: "2024-05-02T09:00:00.000Z",
      }),
    );
    await upsertReview(
      createReview({
        id: "review-fast-1",
        pullRequestId: prAlpha.id,
        authorId: fast.id,
        submittedAt: "2024-05-02T10:00:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-fast-2",
        pullRequestId: prBeta.id,
        reviewerId: fast.id,
        requestedAt: "2024-05-06T09:15:00.000Z",
      }),
    );
    await upsertComment(
      createComment({
        id: "comment-fast-2",
        pullRequestId: prBeta.id,
        authorId: fast.id,
        createdAt: "2024-05-06T10:15:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-fast-ignored",
        pullRequestId: prDelta.id,
        reviewerId: fast.id,
        requestedAt: "2024-05-10T09:00:00.000Z",
      }),
    );
    await markReviewRequestRemoved({
      pullRequestId: prDelta.id,
      reviewerId: fast.id,
      removedAt: "2024-05-10T09:10:00.000Z",
      raw: { id: "rr-fast-ignored", removedAt: "2024-05-10T09:10:00.000Z" },
    });
    await upsertReview(
      createReview({
        id: "review-fast-ignored",
        pullRequestId: prDelta.id,
        authorId: fast.id,
        submittedAt: "2024-05-10T09:20:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-slow-1",
        pullRequestId: prAlpha.id,
        reviewerId: slow.id,
        requestedAt: "2024-05-02T09:05:00.000Z",
      }),
    );
    await upsertReview(
      createReview({
        id: "review-slow-1",
        pullRequestId: prAlpha.id,
        authorId: slow.id,
        submittedAt: "2024-05-02T16:05:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-slow-2",
        pullRequestId: prGamma.id,
        reviewerId: slow.id,
        requestedAt: "2024-05-08T11:00:00.000Z",
      }),
    );
    await upsertReview(
      createReview({
        id: "review-slow-2",
        pullRequestId: prGamma.id,
        authorId: slow.id,
        submittedAt: "2024-05-09T11:00:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-react-1",
        pullRequestId: prGamma.id,
        reviewerId: reactor.id,
        requestedAt: "2024-05-08T09:00:00.000Z",
      }),
    );
    await upsertReaction(
      createReaction({
        id: "reaction-react-1",
        pullRequestId: prGamma.id,
        userId: reactor.id,
        createdAt: "2024-05-08T11:00:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-react-2",
        pullRequestId: prBeta.id,
        reviewerId: reactor.id,
        requestedAt: "2024-05-06T13:00:00.000Z",
      }),
    );
    await upsertReaction(
      createReaction({
        id: "reaction-react-2",
        pullRequestId: prBeta.id,
        userId: reactor.id,
        createdAt: "2024-05-06T19:00:00.000Z",
      }),
    );

    await upsertReviewRequest(
      createReviewRequest({
        id: "rr-idle",
        pullRequestId: prBeta.id,
        reviewerId: idle.id,
        requestedAt: "2024-05-06T09:20:00.000Z",
      }),
    );

    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const responderEntries = analytics.leaderboard.fastestResponders;
    expect(responderEntries).toHaveLength(3);
    const responderIds = responderEntries.map((entry) => entry.user.id);

    expect(responderIds).toEqual([fast.id, reactor.id, slow.id]);

    const fastEntry = responderEntries[0];
    const reactorEntry = responderEntries[1];
    const slowEntry = responderEntries[2];

    expect(fastEntry.value).toBeCloseTo(1, 5);
    expect(fastEntry.secondaryValue).toBe(2);

    expect(reactorEntry.value).toBeCloseTo(4, 5);
    expect(reactorEntry.secondaryValue).toBe(2);

    expect(slowEntry.value).toBeCloseTo(15.5, 5);
    expect(slowEntry.secondaryValue).toBe(2);

    expect(responderIds).not.toContain(idle.id);
  });
});
