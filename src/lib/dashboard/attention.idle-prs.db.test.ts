// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getAttentionInsights } from "@/lib/dashboard/attention";
import { differenceInBusinessDays } from "@/lib/dashboard/business-days";
import { ensureSchema } from "@/lib/db";
import {
  updateSyncConfig,
  upsertComment,
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
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

describe.sequential("attention insights for idle pull requests", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: ["repo-excluded"],
      excludedUsers: ["user-excluded"],
    });
  }, 120000);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns inactivity business days, aggregates reviewers, and filters exclusions", async () => {
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

    const idleCreatedAt = "2023-12-20T00:00:00.000Z";
    const idleUpdatedAt = "2024-02-01T12:00:00.000Z";

    const includedIdlePr = buildPullRequest({
      id: "pr-idle-included",
      number: 101,
      repository: includedRepo,
      authorId: alice.id,
      title: "Cache refresh improvements",
      url: "https://github.com/acme/included/pull/101",
      createdAt: idleCreatedAt,
      updatedAt: idleUpdatedAt,
    });

    const excludedRepoPr = buildPullRequest({
      id: "pr-idle-excluded-repo",
      number: 7,
      repository: excludedRepo,
      authorId: alice.id,
      title: "Hidden via repo exclusion",
      url: "https://github.com/acme/excluded/pull/7",
      createdAt: "2023-12-01T00:00:00.000Z",
      updatedAt: "2024-01-30T09:00:00.000Z",
    });

    const excludedAuthorPr = buildPullRequest({
      id: "pr-idle-excluded-author",
      number: 8,
      repository: includedRepo,
      authorId: excludedAuthor.id,
      title: "Hidden via author exclusion",
      url: "https://github.com/acme/included/pull/8",
      createdAt: "2023-11-15T00:00:00.000Z",
      updatedAt: "2024-01-20T09:00:00.000Z",
    });

    const recentlyUpdatedPr = buildPullRequest({
      id: "pr-idle-recent",
      number: 9,
      repository: includedRepo,
      authorId: alice.id,
      title: "Updated too recently",
      url: "https://github.com/acme/included/pull/9",
      createdAt: "2023-12-20T00:00:00.000Z",
      updatedAt: "2024-02-16T10:00:00.000Z",
    });

    for (const pr of [
      includedIdlePr,
      excludedRepoPr,
      excludedAuthorPr,
      recentlyUpdatedPr,
    ]) {
      await upsertPullRequest(pr);
    }

    const reviewerRequest = buildReviewRequest({
      id: "idle-rr-1",
      pullRequestId: includedIdlePr.id,
      reviewerId: bob.id,
      requestedAt: "2024-01-05T09:00:00.000Z",
    });

    const reviewerRequestDuplicate = buildReviewRequest({
      id: "idle-rr-duplicate",
      pullRequestId: includedIdlePr.id,
      reviewerId: bob.id,
      requestedAt: "2024-01-08T09:00:00.000Z",
    });

    const submittedReview = buildReview({
      id: "idle-review-1",
      pullRequestId: includedIdlePr.id,
      authorId: carol.id,
      submittedAt: "2024-01-25T10:00:00.000Z",
      state: "COMMENTED",
    });

    for (const request of [reviewerRequest, reviewerRequestDuplicate]) {
      await upsertReviewRequest(request);
    }
    await upsertReview(submittedReview);

    const insights = await getAttentionInsights();
    expect(insights.timezone).toBe("Asia/Seoul");
    expect(insights.idleOpenPrs).toHaveLength(1);

    const [item] = insights.idleOpenPrs;
    expect(item.id).toBe(includedIdlePr.id);
    expect(item.number).toBe(101);
    expect(item.title).toBe("Cache refresh improvements");
    expect(item.url).toBe("https://github.com/acme/included/pull/101");
    expect(new Date(item.createdAt).toISOString()).toBe(idleCreatedAt);
    expect(item.updatedAt).not.toBeNull();
    expect(new Date(item.updatedAt as string).toISOString()).toBe(
      idleUpdatedAt,
    );

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

    const expectedAge = differenceInBusinessDays(
      idleCreatedAt,
      new Date(FIXED_NOW),
    );
    const expectedInactivity = differenceInBusinessDays(
      idleUpdatedAt,
      new Date(FIXED_NOW),
    );

    expect(item.ageDays).toBe(expectedAge);
    expect(item.inactivityDays).toBe(expectedInactivity);

    const generatedAt = new Date(insights.generatedAt).toISOString();
    expect(generatedAt).toBe(FIXED_NOW);
  });

  it("ignores octoaide-only updates when calculating inactivity", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const author = buildActor("user-author", "author", "Author");
    const octoaide = buildActor("user-octoaide", "octoaide", "octoaide");

    for (const actor of [owner, author, octoaide]) {
      await upsertUser(actor);
    }

    const repository = buildRepository(
      "repo-octoaide",
      "octoaide-repo",
      owner.id,
      owner.login ?? "owner",
    );
    await upsertRepository(repository);

    const createdAt = "2023-12-01T00:00:00.000Z";
    const humanUpdatedAt = "2024-02-01T09:00:00.000Z";
    const octoaideUpdatedAt = "2024-02-18T09:00:00.000Z";

    const pullRequestUrl = "https://github.com/acme/octoaide-repo/pull/202";

    const basePullRequest = buildPullRequest({
      id: "pr-octoaide-ignore",
      number: 202,
      repository,
      authorId: author.id,
      title: "AI helper follow-up",
      url: pullRequestUrl,
      createdAt,
      updatedAt: humanUpdatedAt,
    });
    await upsertPullRequest(basePullRequest);

    await upsertComment({
      id: "comment-human",
      pullRequestId: basePullRequest.id,
      authorId: author.id,
      createdAt: humanUpdatedAt,
      raw: {
        id: "comment-human",
        __typename: "IssueComment",
        body: "Manual update",
      },
    });

    const octoaidePullRequest = buildPullRequest({
      id: basePullRequest.id,
      number: basePullRequest.number,
      repository,
      authorId: author.id,
      title: basePullRequest.title ?? "",
      url: pullRequestUrl,
      createdAt,
      updatedAt: octoaideUpdatedAt,
    });
    await upsertPullRequest(octoaidePullRequest);

    await upsertComment({
      id: "comment-octoaide",
      pullRequestId: basePullRequest.id,
      authorId: octoaide.id,
      createdAt: octoaideUpdatedAt,
      raw: {
        id: "comment-octoaide",
        __typename: "IssueComment",
        body: "Automated suggestion",
      },
    });

    const insights = await getAttentionInsights();
    expect(insights.idleOpenPrs).toHaveLength(1);

    const [item] = insights.idleOpenPrs;
    expect(item.id).toBe(basePullRequest.id);
    expect(new Date(item.updatedAt as string).toISOString()).toBe(
      humanUpdatedAt,
    );

    const expectedInactivity = differenceInBusinessDays(
      humanUpdatedAt,
      new Date(FIXED_NOW),
    );
    expect(item.inactivityDays).toBe(expectedInactivity);
  });
});
