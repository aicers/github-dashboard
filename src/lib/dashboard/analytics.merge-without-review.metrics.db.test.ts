import "../../../tests/helpers/postgres-container";
import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import type { PeriodKey } from "@/lib/dashboard/types";
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
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
} from "../../../tests/helpers/dashboard-metrics";
import { formatMetricSnapshotForTest } from "../../../tests/helpers/metric-formatting";

const PERIODS = PERIOD_KEYS;

function hoursBefore(iso: string, hours: number) {
  const base = new Date(iso).getTime();
  return new Date(base - hours * 3_600_000).toISOString();
}

describe("analytics merge without review metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("builds merge without review ratio metrics with five-period history", async () => {
    const author: DbActor = {
      id: "merge-no-review-author",
      login: "octomerge",
      name: "Octo Merge",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "merge-no-review-reviewer",
      login: "octoreviewer",
      name: "Octo Reviewer",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabot: DbActor = {
      id: "merge-no-review-dependabot",
      login: "dependabot[bot]",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);
    await upsertUser(reviewer);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "repo-merge-no-review",
      name: "merge-no-review-repo",
      nameWithOwner: "octo/merge-no-review-repo",
      ownerId: author.id,
      raw: { id: "repo-merge-no-review" },
    };
    await upsertRepository(repository);

    type Period = PeriodKey;
    type ReviewKind = "approved" | "none" | "null";

    const mergeSpecs: Record<
      Period,
      Array<{
        key: string;
        mergedAt: string;
        review: ReviewKind;
        authorId?: string;
      }>
    > = {
      previous4: [
        {
          key: "previous4-reviewed",
          mergedAt: "2023-12-05T12:00:00.000Z",
          review: "approved",
        },
        {
          key: "previous4-no-review",
          mergedAt: "2023-12-06T15:30:00.000Z",
          review: "none",
        },
        {
          key: "previous4-null-review",
          mergedAt: "2023-12-07T19:45:00.000Z",
          review: "null",
        },
      ],
      previous3: [
        {
          key: "previous3-reviewed",
          mergedAt: "2023-12-12T10:45:00.000Z",
          review: "approved",
        },
        {
          key: "previous3-no-review",
          mergedAt: "2023-12-13T14:30:00.000Z",
          review: "none",
        },
      ],
      previous2: [
        {
          key: "previous2-reviewed",
          mergedAt: "2023-12-19T09:15:00.000Z",
          review: "approved",
        },
        {
          key: "previous2-dependabot-no-review",
          mergedAt: "2023-12-21T11:45:00.000Z",
          review: "none",
          authorId: dependabot.id,
        },
      ],
      previous: [
        {
          key: "previous-reviewed",
          mergedAt: "2023-12-27T11:00:00.000Z",
          review: "approved",
        },
        {
          key: "previous-no-review",
          mergedAt: "2023-12-29T19:30:00.000Z",
          review: "none",
        },
        {
          key: "previous-dependabot-no-review",
          mergedAt: "2023-12-30T22:15:00.000Z",
          review: "none",
          authorId: dependabot.id,
        },
      ],
      current: [
        {
          key: "current-reviewed",
          mergedAt: "2024-01-02T08:00:00.000Z",
          review: "approved",
        },
        {
          key: "current-no-review",
          mergedAt: "2024-01-04T15:30:00.000Z",
          review: "none",
        },
        {
          key: "current-null-review",
          mergedAt: "2024-01-06T20:45:00.000Z",
          review: "null",
        },
        {
          key: "current-dependabot-no-review",
          mergedAt: "2024-01-07T23:00:00.000Z",
          review: "none",
          authorId: dependabot.id,
        },
      ],
    } as const;

    let pullNumber = 1_000;
    let reviewIndex = 1;
    const insertMergedPullRequest = async ({
      key,
      mergedAt,
      review,
      authorId,
    }: {
      key: string;
      mergedAt: string;
      review: ReviewKind;
      authorId?: string;
    }) => {
      const prAuthorId = authorId ?? author.id;
      const createdAt = hoursBefore(mergedAt, 20);
      const pullRequest: DbPullRequest = {
        id: `${repository.id}-${key}`,
        number: pullNumber++,
        repositoryId: repository.id,
        authorId: prAuthorId,
        title: `${repository.name} #${pullNumber}`,
        state: "MERGED",
        createdAt,
        updatedAt: mergedAt,
        closedAt: mergedAt,
        mergedAt,
        merged: true,
        raw: {
          author: { id: prAuthorId },
          mergedBy: { id: prAuthorId },
          comments: { totalCount: 0 },
          additions: 0,
          deletions: 0,
        },
      };

      await upsertPullRequest(pullRequest);

      if (review === "approved" || review === "null") {
        const submittedAt = review === "approved" ? mergedAt : null;
        const dbReview: DbReview = {
          id: `${pullRequest.id}-review-${reviewIndex++}`,
          pullRequestId: pullRequest.id,
          authorId: reviewer.id,
          state: review === "approved" ? "APPROVED" : "COMMENTED",
          submittedAt,
          raw: {},
        };
        await upsertReview(dbReview);
      }
    };

    for (const period of PERIODS) {
      for (const specification of mergeSpecs[period]) {
        await insertMergedPullRequest(specification);
      }
    }

    await insertMergedPullRequest({
      key: "outside-period",
      mergedAt: "2023-11-10T10:00:00.000Z",
      review: "none",
    });

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const mergeWithoutReview =
      analytics.organization.metrics.mergeWithoutReviewRatio;
    const expectedRatios = Object.fromEntries(
      PERIODS.map((period) => {
        const specs = mergeSpecs[period];
        const nonDependabotSpecs = specs.filter((spec) => {
          const specAuthorId = spec.authorId ?? author.id;
          return specAuthorId !== dependabot.id;
        });
        const numerator = nonDependabotSpecs.filter(
          (spec) => spec.review !== "approved",
        ).length;
        const denominator = nonDependabotSpecs.length;
        const ratio = denominator === 0 ? 0 : numerator / denominator;
        return [period, { numerator, denominator, ratio }];
      }),
    ) as Record<
      Period,
      { numerator: number; denominator: number; ratio: number }
    >;

    expect(mergeWithoutReview.current).toBeCloseTo(
      expectedRatios.current.ratio,
      5,
    );
    expect(mergeWithoutReview.previous).toBeCloseTo(
      expectedRatios.previous.ratio,
      5,
    );

    const expectedAbsoluteChange =
      expectedRatios.current.ratio - expectedRatios.previous.ratio;
    expect(mergeWithoutReview.absoluteChange).toBeCloseTo(
      expectedAbsoluteChange,
      5,
    );

    const expectedPercentChange =
      ((expectedRatios.current.ratio - expectedRatios.previous.ratio) /
        expectedRatios.previous.ratio) *
      100;
    expect(mergeWithoutReview.percentChange).not.toBeNull();
    expect(mergeWithoutReview.percentChange ?? 0).toBeCloseTo(
      expectedPercentChange,
      5,
    );

    const history =
      analytics.organization.metricHistory.mergeWithoutReviewRatio;
    expect(history).toHaveLength(PERIODS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      expect(entry.value).toBeCloseTo(expectedRatios[entry.period].ratio, 5);
    });

    const ratioSnapshot = formatMetricSnapshotForTest(
      mergeWithoutReview,
      "percentage",
    );
    const expectedRatioSnapshot = formatMetricSnapshotForTest(
      {
        current: expectedRatios.current.ratio,
        absoluteChange: expectedAbsoluteChange,
        percentChange: expectedPercentChange,
      },
      "percentage",
    );
    expect(ratioSnapshot.valueLabel).toBe(expectedRatioSnapshot.valueLabel);
    expect(`${ratioSnapshot.changeLabel} (${ratioSnapshot.percentLabel})`).toBe(
      `${expectedRatioSnapshot.changeLabel} (${expectedRatioSnapshot.percentLabel})`,
    );
  });

  it("handles merge without review ratio when previous period has no merges", async () => {
    const author: DbActor = {
      id: "merge-no-review-author-delta",
      login: "octomerge-delta",
      name: "Octo Merge Delta",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "merge-no-review-reviewer-delta",
      login: "octoreviewer-delta",
      name: "Octo Reviewer Delta",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);
    await upsertUser(reviewer);

    const repository: DbRepository = {
      id: "repo-merge-no-review-delta",
      name: "merge-no-review-delta",
      nameWithOwner: "octo/merge-no-review-delta",
      ownerId: author.id,
      raw: { id: "repo-merge-no-review-delta" },
    };
    await upsertRepository(repository);

    let pullNumber = 2_000;
    const insertMergedPullRequest = async ({
      key,
      mergedAt,
      hasReview,
    }: {
      key: string;
      mergedAt: string;
      hasReview: boolean;
    }) => {
      const createdAt = hoursBefore(mergedAt, 14);
      const pullRequest: DbPullRequest = {
        id: `${repository.id}-${key}`,
        number: pullNumber++,
        repositoryId: repository.id,
        authorId: author.id,
        title: `${repository.name} #${pullNumber}`,
        state: "MERGED",
        createdAt,
        updatedAt: mergedAt,
        closedAt: mergedAt,
        mergedAt,
        merged: true,
        raw: {
          author: { id: author.id },
          mergedBy: { id: author.id },
          comments: { totalCount: 0 },
          additions: 0,
          deletions: 0,
        },
      };

      await upsertPullRequest(pullRequest);

      if (hasReview) {
        const review: DbReview = {
          id: `${pullRequest.id}-review-1`,
          pullRequestId: pullRequest.id,
          authorId: reviewer.id,
          state: "APPROVED",
          submittedAt: pullRequest.mergedAt,
          raw: {},
        };
        await upsertReview(review);
      }
    };

    await insertMergedPullRequest({
      key: "current-reviewed",
      mergedAt: "2024-01-03T12:00:00.000Z",
      hasReview: true,
    });
    await insertMergedPullRequest({
      key: "current-no-review",
      mergedAt: "2024-01-05T17:30:00.000Z",
      hasReview: false,
    });

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const mergeWithoutReview =
      analytics.organization.metrics.mergeWithoutReviewRatio;

    expect(mergeWithoutReview.previous).toBe(0);
    expect(mergeWithoutReview.current).toBeCloseTo(0.5, 5);
    expect(mergeWithoutReview.absoluteChange).toBeCloseTo(0.5, 5);
    expect(mergeWithoutReview.percentChange).toBeNull();

    const ratioSnapshot = formatMetricSnapshotForTest(
      mergeWithoutReview,
      "percentage",
    );
    const expectedRatioSnapshot = formatMetricSnapshotForTest(
      {
        current: 0.5,
        absoluteChange: 0.5,
        percentChange: null,
      },
      "percentage",
    );
    expect(ratioSnapshot.valueLabel).toBe(expectedRatioSnapshot.valueLabel);
    expect(`${ratioSnapshot.changeLabel} (${ratioSnapshot.percentLabel})`).toBe(
      `${expectedRatioSnapshot.changeLabel} (${expectedRatioSnapshot.percentLabel})`,
    );
  });

  it("returns zero merge without review ratio when no merges exist", async () => {
    const author: DbActor = {
      id: "merge-no-review-author-empty",
      login: "octomerge-empty",
      name: "Octo Merge Empty",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);

    const repository: DbRepository = {
      id: "repo-merge-no-review-empty",
      name: "merge-no-review-empty",
      nameWithOwner: "octo/merge-no-review-empty",
      ownerId: author.id,
      raw: { id: "repo-merge-no-review-empty" },
    };
    await upsertRepository(repository);

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const mergeWithoutReview =
      analytics.organization.metrics.mergeWithoutReviewRatio;

    expect(mergeWithoutReview.current).toBe(0);
    expect(mergeWithoutReview.previous).toBe(0);
    expect(mergeWithoutReview.absoluteChange).toBe(0);
    expect(mergeWithoutReview.percentChange).toBe(0);

    const history =
      analytics.organization.metricHistory.mergeWithoutReviewRatio;
    history.forEach((entry) => {
      expect(entry.value).toBe(0);
    });

    const ratioSnapshot = formatMetricSnapshotForTest(
      mergeWithoutReview,
      "percentage",
    );
    const expectedRatioSnapshot = formatMetricSnapshotForTest(
      {
        current: 0,
        absoluteChange: 0,
        percentChange: 0,
      },
      "percentage",
    );
    expect(ratioSnapshot.valueLabel).toBe(expectedRatioSnapshot.valueLabel);
    expect(`${ratioSnapshot.changeLabel} (${ratioSnapshot.percentLabel})`).toBe(
      `${expectedRatioSnapshot.changeLabel} (${expectedRatioSnapshot.percentLabel})`,
    );
  });
});
