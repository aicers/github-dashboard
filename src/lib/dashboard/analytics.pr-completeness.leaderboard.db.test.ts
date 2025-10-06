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

const RANGE_START = "2024-07-01T00:00:00.000Z";
const RANGE_END = "2024-07-31T23:59:59.999Z";

function buildActor(id: string, login: string, name?: string): DbActor {
  return {
    id,
    login,
    name: name ?? login,
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  } satisfies DbActor;
}

function buildRepository(
  id: string,
  name: string,
  ownerId: string,
): DbRepository {
  return {
    id,
    name,
    nameWithOwner: `${ownerId}/${name}`,
    ownerId,
    raw: { id, name },
  } satisfies DbRepository;
}

function createPullRequest(params: {
  id: string;
  number: number;
  repository: DbRepository;
  authorId: string;
  createdAt: string;
  mergedAt?: string | null;
  mergedById?: string | null;
}): DbPullRequest {
  const { id, number, repository, authorId, createdAt, mergedAt, mergedById } =
    params;
  const effectiveMergedAt = mergedAt ?? null;
  const state = effectiveMergedAt ? "MERGED" : "OPEN";
  const updatedAt = effectiveMergedAt ?? createdAt;

  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title: `${repository.name} #${number}`,
    state,
    createdAt,
    updatedAt,
    closedAt: effectiveMergedAt,
    mergedAt: effectiveMergedAt,
    merged: Boolean(effectiveMergedAt),
    raw: {
      id,
      author: { id: authorId },
      mergedAt: effectiveMergedAt,
      mergedBy: mergedById ? { id: mergedById } : null,
    },
  } satisfies DbPullRequest;
}

function createReview(params: {
  id: string;
  pullRequestId: string;
  authorId: string;
  state: string;
  submittedAt: string;
}): DbReview {
  const { id, pullRequestId, authorId, state, submittedAt } = params;

  return {
    id,
    pullRequestId,
    authorId,
    state,
    submittedAt,
    raw: {
      id,
      state,
      submittedAt,
    },
  } satisfies DbReview;
}

describe("analytics PR completeness leaderboard", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("builds average peer review counts per merged PR and surfaces review state breakdown", async () => {
    const owner = buildActor("user-owner", "owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const reviewerCarol = buildActor("user-carol", "carol", "Carol");
    const reviewerDave = buildActor("user-dave", "dave", "Dave");

    for (const actor of [owner, alice, bob, reviewerCarol, reviewerDave]) {
      await upsertUser(actor);
    }

    const repo = buildRepository(
      "repo-pr-completeness",
      "clean-code",
      owner.id,
    );
    await upsertRepository(repo);

    const prAliceFirst = createPullRequest({
      id: "repo-pr-completeness-alice-1",
      number: 101,
      repository: repo,
      authorId: alice.id,
      createdAt: "2024-07-02T09:00:00.000Z",
      mergedAt: "2024-07-04T10:00:00.000Z",
      mergedById: owner.id,
    });
    const prAliceSecond = createPullRequest({
      id: "repo-pr-completeness-alice-2",
      number: 102,
      repository: repo,
      authorId: alice.id,
      createdAt: "2024-07-05T09:00:00.000Z",
      mergedAt: "2024-07-06T12:00:00.000Z",
      mergedById: owner.id,
    });
    const prBob = createPullRequest({
      id: "repo-pr-completeness-bob-1",
      number: 201,
      repository: repo,
      authorId: bob.id,
      createdAt: "2024-07-10T09:00:00.000Z",
      mergedAt: "2024-07-11T11:00:00.000Z",
      mergedById: owner.id,
    });

    for (const pr of [prAliceFirst, prAliceSecond, prBob]) {
      await upsertPullRequest(pr);
    }

    const reviews = [
      createReview({
        id: "review-carol-alice-1-comment",
        pullRequestId: prAliceFirst.id,
        authorId: reviewerCarol.id,
        state: "COMMENTED",
        submittedAt: "2024-07-04T09:30:00.000Z",
      }),
      createReview({
        id: "review-dave-alice-1-change",
        pullRequestId: prAliceFirst.id,
        authorId: reviewerDave.id,
        state: "CHANGES_REQUESTED",
        submittedAt: "2024-07-04T09:45:00.000Z",
      }),
      createReview({
        id: "review-alice-self",
        pullRequestId: prAliceFirst.id,
        authorId: alice.id,
        state: "COMMENTED",
        submittedAt: "2024-07-04T09:50:00.000Z",
      }),
      createReview({
        id: "review-carol-alice-late",
        pullRequestId: prAliceFirst.id,
        authorId: reviewerCarol.id,
        state: "COMMENTED",
        submittedAt: "2024-07-05T09:00:00.000Z",
      }),
      createReview({
        id: "review-carol-bob-comment-1",
        pullRequestId: prBob.id,
        authorId: reviewerCarol.id,
        state: "COMMENTED",
        submittedAt: "2024-07-11T10:00:00.000Z",
      }),
      createReview({
        id: "review-dave-bob-comment-2",
        pullRequestId: prBob.id,
        authorId: reviewerDave.id,
        state: "COMMENTED",
        submittedAt: "2024-07-11T10:15:00.000Z",
      }),
      createReview({
        id: "review-carol-bob-change",
        pullRequestId: prBob.id,
        authorId: reviewerCarol.id,
        state: "CHANGES_REQUESTED",
        submittedAt: "2024-07-11T10:30:00.000Z",
      }),
    ];

    for (const review of reviews) {
      await upsertReview(review);
    }

    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const completionEntries = analytics.leaderboard.prCompleteness;
    expect(completionEntries.map((entry) => entry.user.id)).toEqual([
      alice.id,
      bob.id,
    ]);

    const aliceEntry = completionEntries[0];
    expect(aliceEntry.secondaryValue).toBe(2);
    expect(aliceEntry.value).toBeCloseTo(1);
    expect(aliceEntry.details).toEqual([
      { label: "COMMENTED", value: 1, suffix: "건" },
      { label: "CHANGES_REQUESTED", value: 1, suffix: "건" },
    ]);

    const bobEntry = completionEntries[1];
    expect(bobEntry.secondaryValue).toBe(1);
    expect(bobEntry.value).toBeCloseTo(3);
    expect(bobEntry.details).toEqual([
      { label: "COMMENTED", value: 2, suffix: "건" },
      { label: "CHANGES_REQUESTED", value: 1, suffix: "건" },
    ]);
  });
});
