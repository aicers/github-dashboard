// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAttentionInsights } from "@/lib/dashboard/attention";
import { ensureSchema } from "@/lib/db";
import {
  updateSyncConfig,
  upsertPullRequest,
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
  businessDaysBetween,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

describe("attention insights for stale pull requests", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    await ensureSchema();
    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: ["repo-excluded"],
      excludedUsers: ["user-excluded"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns business-day age, associated users, and filters exclusions", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");
    const excludedAuthor = buildActor("user-excluded", "excluded", "Excluded");

    for (const actor of [owner, alice, bob, carol, excludedAuthor]) {
      await upsertUser(actor);
    }

    const includedRepo = buildRepository(
      "repo-included",
      "included",
      owner.id,
      owner.login ?? "owner",
    );
    const excludedRepo = buildRepository(
      "repo-excluded",
      "excluded",
      owner.id,
      owner.login ?? "owner",
    );
    await upsertRepository(includedRepo);
    await upsertRepository(excludedRepo);

    const staleCreatedAt = "2023-12-20T00:00:00.000Z";
    const staleUpdatedAt = "2024-02-15T12:00:00.000Z";

    const includedStalePr = buildPullRequest({
      id: "pr-stale-included",
      number: 42,
      repository: includedRepo,
      authorId: alice.id,
      title: "Long running feature",
      url: "https://github.com/acme/included/pull/42",
      createdAt: staleCreatedAt,
      updatedAt: staleUpdatedAt,
    });

    const excludedRepoPr = buildPullRequest({
      id: "pr-stale-excluded-repo",
      number: 7,
      repository: excludedRepo,
      authorId: alice.id,
      title: "Should be hidden by repo",
      url: "https://github.com/acme/excluded/pull/7",
      createdAt: "2023-01-10T00:00:00.000Z",
    });

    const excludedAuthorPr = buildPullRequest({
      id: "pr-stale-excluded-author",
      number: 8,
      repository: includedRepo,
      authorId: excludedAuthor.id,
      title: "Hidden by author",
      url: "https://github.com/acme/included/pull/8",
      createdAt: "2023-01-10T00:00:00.000Z",
    });

    const closedStalePr = buildPullRequest({
      id: "pr-stale-closed",
      number: 9,
      repository: includedRepo,
      authorId: alice.id,
      title: "Already closed",
      url: "https://github.com/acme/included/pull/9",
      state: "CLOSED",
      createdAt: "2023-01-10T00:00:00.000Z",
      updatedAt: "2023-02-01T00:00:00.000Z",
      closedAt: "2023-02-01T00:00:00.000Z",
    });

    const recentPr = buildPullRequest({
      id: "pr-recent",
      number: 50,
      repository: includedRepo,
      authorId: alice.id,
      title: "Recent work",
      url: "https://github.com/acme/included/pull/50",
      createdAt: "2024-02-12T00:00:00.000Z",
      updatedAt: "2024-02-18T00:00:00.000Z",
    });

    for (const pr of [
      includedStalePr,
      excludedRepoPr,
      excludedAuthorPr,
      closedStalePr,
      recentPr,
    ]) {
      await upsertPullRequest(pr);
    }

    const reviewerRequest = buildReviewRequest({
      id: "rr-1",
      pullRequestId: includedStalePr.id,
      reviewerId: bob.id,
      requestedAt: "2023-12-22T09:00:00.000Z",
    });

    const reviewerRequestDuplicate = buildReviewRequest({
      id: "rr-duplicate",
      pullRequestId: includedStalePr.id,
      reviewerId: bob.id,
      requestedAt: "2023-12-25T09:00:00.000Z",
    });

    const submittedReview = buildReview({
      id: "review-1",
      pullRequestId: includedStalePr.id,
      authorId: carol.id,
      submittedAt: "2024-01-05T10:00:00.000Z",
      state: "APPROVED",
    });

    for (const request of [reviewerRequest, reviewerRequestDuplicate]) {
      await upsertReviewRequest(request);
    }
    await upsertReview(submittedReview);

    const insights = await getAttentionInsights();

    expect(insights.timezone).toBe("Asia/Seoul");
    expect(insights.staleOpenPrs).toHaveLength(1);

    const [item] = insights.staleOpenPrs;
    expect(item.id).toBe(includedStalePr.id);
    expect(item.number).toBe(42);
    expect(item.title).toBe("Long running feature");
    expect(item.url).toBe("https://github.com/acme/included/pull/42");
    expect(new Date(item.createdAt).toISOString()).toBe(staleCreatedAt);
    expect(item.updatedAt).not.toBeNull();
    expect(new Date(item.updatedAt as string).toISOString()).toBe(
      staleUpdatedAt,
    );
    expect(item.inactivityDays).toBeUndefined();

    expect(item.repository).toEqual({
      id: includedRepo.id,
      name: includedRepo.name,
      nameWithOwner: includedRepo.nameWithOwner,
    });

    expect(item.author).toEqual({
      id: alice.id,
      login: alice.login ?? null,
      name: alice.name ?? null,
    });

    expect(item.reviewers).toHaveLength(2);
    const reviewerIds = item.reviewers.map((reviewer) => reviewer.id).sort();
    expect(reviewerIds).toEqual([bob.id, carol.id].sort());

    const reviewerNames = item.reviewers.map((reviewer) => reviewer.name);
    expect(reviewerNames).toEqual(expect.arrayContaining(["Bob", "Carol"]));

    const expectedAge = businessDaysBetween(staleCreatedAt, FIXED_NOW);
    expect(item.ageDays).toBe(expectedAge);

    const generatedAt = new Date(insights.generatedAt).toISOString();
    expect(generatedAt).toBe(FIXED_NOW);
  });
});
