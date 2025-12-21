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

import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { getAttentionInsights } from "@/lib/dashboard/attention";
import { ensureSchema } from "@/lib/db";
import {
  replaceRepositoryMaintainers,
  updateSyncConfig,
  upsertComment,
  upsertPullRequest,
  upsertRepository,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildActor,
  buildPullRequest,
  buildRepository,
  buildReviewRequest,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

describe.sequential("attention insights for review-stalled pull requests", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [],
      excludedUsers: [],
    });
  }, 120000);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires all reviewers to exceed 2 business days since their last activity/request", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const maintainer = buildActor(
      "user-maintainer",
      "maintainer",
      "Maintainer",
    );
    const author = buildActor("user-author", "author", "Author");
    const reviewerA = buildActor("user-reviewer-a", "reviewer-a", "Reviewer A");
    const reviewerB = buildActor("user-reviewer-b", "reviewer-b", "Reviewer B");

    for (const actor of [owner, maintainer, author, reviewerA, reviewerB]) {
      await upsertUser(actor);
    }

    const repo = buildRepository(
      "repo-review",
      "review",
      owner.id,
      owner.login ?? "owner",
    );
    await upsertRepository(repo);
    await replaceRepositoryMaintainers([
      { repositoryId: repo.id, maintainerIds: [maintainer.id] },
    ]);

    const prEligible = buildPullRequest({
      id: "pr-stalled-eligible",
      number: 101,
      repository: repo,
      authorId: author.id,
      title: "Review stalled (eligible)",
      url: "https://github.com/acme/review/pull/101",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-15T00:00:00.000Z",
    });

    const prRecentReviewerActivity = buildPullRequest({
      id: "pr-stalled-recent-activity",
      number: 102,
      repository: repo,
      authorId: author.id,
      title: "Review stalled (recent activity)",
      url: "https://github.com/acme/review/pull/102",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-15T00:00:00.000Z",
    });

    const prOneReviewerNotElapsed = buildPullRequest({
      id: "pr-stalled-one-reviewer-not-elapsed",
      number: 103,
      repository: repo,
      authorId: author.id,
      title: "Review stalled (one reviewer not elapsed)",
      url: "https://github.com/acme/review/pull/103",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-19T00:00:00.000Z",
    });

    for (const pr of [
      prEligible,
      prRecentReviewerActivity,
      prOneReviewerNotElapsed,
    ]) {
      await upsertPullRequest(pr);
    }

    const requestedOld = "2024-02-15T00:00:00.000Z";
    const requestedRecent = "2024-02-19T00:00:00.000Z";

    const requests = [
      // Eligible: both reviewers requested long enough ago.
      buildReviewRequest({
        id: "rr-eligible-a",
        pullRequestId: prEligible.id,
        reviewerId: reviewerA.id,
        requestedAt: requestedOld,
      }),
      buildReviewRequest({
        id: "rr-eligible-b",
        pullRequestId: prEligible.id,
        reviewerId: reviewerB.id,
        requestedAt: requestedOld,
      }),
      // Recent activity: same request times.
      buildReviewRequest({
        id: "rr-recent-a",
        pullRequestId: prRecentReviewerActivity.id,
        reviewerId: reviewerA.id,
        requestedAt: requestedOld,
      }),
      buildReviewRequest({
        id: "rr-recent-b",
        pullRequestId: prRecentReviewerActivity.id,
        reviewerId: reviewerB.id,
        requestedAt: requestedOld,
      }),
      // One reviewer not elapsed: reviewer B requested recently.
      buildReviewRequest({
        id: "rr-one-not-a",
        pullRequestId: prOneReviewerNotElapsed.id,
        reviewerId: reviewerA.id,
        requestedAt: requestedOld,
      }),
      buildReviewRequest({
        id: "rr-one-not-b",
        pullRequestId: prOneReviewerNotElapsed.id,
        reviewerId: reviewerB.id,
        requestedAt: requestedRecent,
      }),
    ];
    for (const rr of requests) {
      await upsertReviewRequest(rr);
    }

    // Eligible PR has reviewer activity after request, but is idle long enough afterwards.
    await upsertComment({
      id: "comment-reviewer-a-eligible",
      issueId: null,
      pullRequestId: prEligible.id,
      reviewId: null,
      authorId: reviewerA.id,
      createdAt: "2024-02-15T12:00:00.000Z",
      updatedAt: "2024-02-15T12:00:00.000Z",
      raw: {
        id: "comment-reviewer-a-eligible",
        pullRequestId: prEligible.id,
        url: "https://github.com/acme/review/pull/101#issuecomment-eligible-a",
        body: "Taking a look.",
      },
    });
    await upsertComment({
      id: "comment-reviewer-b-eligible",
      issueId: null,
      pullRequestId: prEligible.id,
      reviewId: null,
      authorId: reviewerB.id,
      createdAt: "2024-02-15T13:00:00.000Z",
      updatedAt: "2024-02-15T13:00:00.000Z",
      raw: {
        id: "comment-reviewer-b-eligible",
        pullRequestId: prEligible.id,
        url: "https://github.com/acme/review/pull/101#issuecomment-eligible-b",
        body: "Will review soon.",
      },
    });

    // Reviewer A recently commented on PR 102 (after request), so it should not be stalled.
    await upsertComment({
      id: "comment-reviewer-a-recent",
      issueId: null,
      pullRequestId: prRecentReviewerActivity.id,
      reviewId: null,
      authorId: reviewerA.id,
      createdAt: requestedRecent,
      updatedAt: requestedRecent,
      raw: {
        id: "comment-reviewer-a-recent",
        pullRequestId: prRecentReviewerActivity.id,
        url: "https://github.com/acme/review/pull/102#issuecomment-1",
        body: "LGTM-ish",
      },
    });

    await refreshActivityItemsSnapshot({ truncate: true });

    const insights = await getAttentionInsights();

    expect(insights.reviewStalledPrs.map((item) => item.id)).toEqual([
      prEligible.id,
    ]);
  });
});
