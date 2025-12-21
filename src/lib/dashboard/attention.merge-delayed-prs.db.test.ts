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
  replaceRepositoryMaintainers,
  updateSyncConfig,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildActor,
  buildPullRequest,
  buildRepository,
  buildReview,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

describe.sequential("attention insights for merge-delayed pull requests", () => {
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

  it("includes PRs only when reviewDecision is APPROVED and all maintainers elapsed 2 business days after approval", async () => {
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
    const reviewer = buildActor("user-reviewer", "reviewer", "Reviewer");

    for (const actor of [owner, maintainerA, maintainerB, author, reviewer]) {
      await upsertUser(actor);
    }

    const repoSingle = buildRepository(
      "repo-merge-single",
      "merge-single",
      owner.id,
      owner.login ?? "owner",
    );
    const repoMulti = buildRepository(
      "repo-merge-multi",
      "merge-multi",
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

    await createUserPersonalHoliday({
      userId: maintainerB.id,
      label: "PTO",
      startDate: "2024-02-16",
      endDate: "2024-02-16",
    });

    const approvalAt = "2024-02-15T00:00:00.000Z";

    const eligible = buildPullRequest({
      id: "pr-merge-eligible",
      number: 201,
      repository: repoSingle,
      authorId: author.id,
      title: "Merge delayed (eligible)",
      url: "https://github.com/acme/merge-single/pull/201",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-19T00:00:00.000Z",
    });
    eligible.raw = {
      ...((eligible.raw ?? {}) as Record<string, unknown>),
      reviewDecision: "APPROVED",
    };

    const blocked = buildPullRequest({
      id: "pr-merge-blocked",
      number: 202,
      repository: repoMulti,
      authorId: author.id,
      title: "Merge delayed (blocked)",
      url: "https://github.com/acme/merge-multi/pull/202",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-19T00:00:00.000Z",
    });
    blocked.raw = {
      ...((blocked.raw ?? {}) as Record<string, unknown>),
      reviewDecision: "APPROVED",
    };

    const notApprovedDecision = buildPullRequest({
      id: "pr-merge-not-approved-decision",
      number: 203,
      repository: repoSingle,
      authorId: author.id,
      title: "Merge delayed (not approved decision)",
      url: "https://github.com/acme/merge-single/pull/203",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-19T00:00:00.000Z",
    });
    notApprovedDecision.raw = {
      ...((notApprovedDecision.raw ?? {}) as Record<string, unknown>),
      reviewDecision: "REVIEW_REQUIRED",
    };

    for (const pr of [eligible, blocked, notApprovedDecision]) {
      await upsertPullRequest(pr);
    }

    const approvals = [
      buildReview({
        id: "review-approved-eligible",
        pullRequestId: eligible.id,
        authorId: reviewer.id,
        submittedAt: approvalAt,
        state: "APPROVED",
      }),
      buildReview({
        id: "review-approved-blocked",
        pullRequestId: blocked.id,
        authorId: reviewer.id,
        submittedAt: approvalAt,
        state: "APPROVED",
      }),
      buildReview({
        id: "review-approved-not-decision",
        pullRequestId: notApprovedDecision.id,
        authorId: reviewer.id,
        submittedAt: approvalAt,
        state: "APPROVED",
      }),
    ];
    for (const review of approvals) {
      await upsertReview(review);
    }

    await refreshActivityItemsSnapshot({ truncate: true });

    const insights = await getAttentionInsights();

    expect(insights.mergeDelayedPrs.map((item) => item.id)).toEqual([
      eligible.id,
    ]);
  });
});
