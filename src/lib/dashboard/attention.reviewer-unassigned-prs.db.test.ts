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
  createUserPersonalHoliday,
  markReviewRequestRemoved,
  replaceRepositoryMaintainers,
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
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

describe.sequential("attention insights for reviewer-unassigned pull requests", () => {
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

  it("includes PRs only when all maintainers elapsed 2 business days, respecting personal holidays", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const maintainerA = buildActor(
      "user-maintainer-a",
      "maintainer-a",
      "Maintainer A",
    );
    const maintainerB = buildActor(
      "user-maintainer-b",
      "maintainer-b",
      "Maintainer B",
    );
    const author = buildActor("user-author", "author", "Author");

    for (const actor of [owner, maintainerA, maintainerB, author]) {
      await upsertUser(actor);
    }

    const repoSingle = buildRepository(
      "repo-single",
      "single",
      owner.id,
      owner.login ?? "owner",
    );
    const repoMulti = buildRepository(
      "repo-multi",
      "multi",
      owner.id,
      owner.login ?? "owner",
    );
    await upsertRepository(repoSingle);
    await upsertRepository(repoMulti);

    await replaceRepositoryMaintainers([
      { repositoryId: repoSingle.id, maintainerIds: [maintainerA.id] },
      {
        repositoryId: repoMulti.id,
        maintainerIds: [maintainerA.id, maintainerB.id],
      },
    ]);

    // Maintainer B takes 2024-02-16 off (Asia/Seoul date).
    await createUserPersonalHoliday({
      userId: maintainerB.id,
      label: "PTO",
      startDate: "2024-02-16",
      endDate: "2024-02-16",
    });

    const createdAt = "2024-02-15T00:00:00.000Z";

    const eligible = buildPullRequest({
      id: "pr-unassigned-eligible",
      number: 101,
      repository: repoSingle,
      authorId: author.id,
      title: "Unassigned review (eligible)",
      url: "https://github.com/acme/single/pull/101",
      createdAt,
      updatedAt: createdAt,
    });

    const blocked = buildPullRequest({
      id: "pr-unassigned-blocked",
      number: 102,
      repository: repoMulti,
      authorId: author.id,
      title: "Unassigned review (blocked)",
      url: "https://github.com/acme/multi/pull/102",
      createdAt,
      updatedAt: createdAt,
    });

    const reviewed = buildPullRequest({
      id: "pr-unassigned-reviewed",
      number: 103,
      repository: repoSingle,
      authorId: author.id,
      title: "Not unassigned (review request removed, review exists)",
      url: "https://github.com/acme/single/pull/103",
      createdAt,
      updatedAt: createdAt,
    });

    await upsertPullRequest(eligible);
    await upsertPullRequest(blocked);
    await upsertPullRequest(reviewed);

    const request = buildReviewRequest({
      id: "rr-removed",
      pullRequestId: reviewed.id,
      reviewerId: maintainerA.id,
      requestedAt: "2024-02-15T09:00:00.000Z",
    });
    await upsertReviewRequest(request);
    await markReviewRequestRemoved({
      pullRequestId: reviewed.id,
      reviewerId: maintainerA.id,
      removedAt: "2024-02-16T09:00:00.000Z",
      raw: { from: "test" },
    });
    await upsertReview(
      buildReview({
        id: "review-removed",
        pullRequestId: reviewed.id,
        authorId: maintainerA.id,
        submittedAt: "2024-02-16T09:00:00.000Z",
        state: "COMMENTED",
      }),
    );

    await refreshActivityItemsSnapshot({ truncate: true });

    const insights = await getAttentionInsights();

    expect(insights.reviewerUnassignedPrs.map((item) => item.id)).toEqual([
      eligible.id,
    ]);
    expect(insights.reviewStalledPrs).toHaveLength(0);
    expect(insights.mergeDelayedPrs).toHaveLength(0);

    const [item] = insights.reviewerUnassignedPrs;
    expect(item.waitingDays).toBeGreaterThanOrEqual(2);
  });
});
