// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbPullRequest,
  type DbReview,
  upsertPullRequest,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildPeriodRanges,
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
  seedPersonAndRepo,
  shiftHours,
} from "../../../tests/helpers/dashboard-metrics";

type ReviewCountSpec = {
  total: number;
  approved: number;
};

describe("people review completion metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("counts completed and approved reviews for individuals", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const prAuthor: DbActor = {
      id: "pr-author",
      login: "prauthor",
      name: "PR Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(prAuthor);

    const reviewSpecs: Record<(typeof PERIOD_KEYS)[number], ReviewCountSpec> = {
      previous4: { total: 1, approved: 0 },
      previous3: { total: 2, approved: 1 },
      previous2: { total: 2, approved: 1 },
      previous: { total: 3, approved: 2 },
      current: { total: 4, approved: 3 },
    } as const;

    let prNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const { total, approved } = reviewSpecs[period];
      for (let index = 0; index < total; index += 1) {
        const createdAt = shiftHours(start, 6 + index * 4);
        const pullRequestId = `${period}-reviewed-pr-${index}`;
        const pullRequest: DbPullRequest = {
          id: pullRequestId,
          number: prNumber,
          repositoryId: repository.id,
          authorId: prAuthor.id,
          title: `Reviewed PR ${prNumber}`,
          state: "OPEN",
          createdAt,
          updatedAt: createdAt,
          closedAt: null,
          mergedAt: null,
          merged: false,
          raw: { title: `Reviewed ${prNumber}` },
        };
        prNumber += 1;
        await upsertPullRequest(pullRequest);

        const state = index < approved ? "APPROVED" : "COMMENTED";
        const submittedAt = shiftHours(createdAt, 2);
        const review: DbReview = {
          id: `${pullRequestId}-review-${index}`,
          pullRequestId,
          authorId: actor.id,
          state,
          submittedAt,
          raw: { state },
        };
        await upsertReview(review);
      }
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      personId: actor.id,
    });

    const individual = analytics.individual;
    expect(individual).not.toBeNull();
    if (!individual) {
      throw new Error("individual analytics missing");
    }
    const metrics = individual.metrics;
    const history = individual.metricHistory;

    const expectedReviewsHistory = PERIOD_KEYS.map(
      (period) => reviewSpecs[period].total,
    );
    const expectedActiveHistory = PERIOD_KEYS.map(
      (period) => reviewSpecs[period].approved,
    );

    const reviewsMetric = metrics.reviewsCompleted;
    expect(reviewsMetric.current).toBe(reviewSpecs.current.total);
    expect(reviewsMetric.previous).toBe(reviewSpecs.previous.total);

    const activeMetric = metrics.activeReviewsCompleted;
    expect(activeMetric.current).toBe(reviewSpecs.current.approved);
    expect(activeMetric.previous).toBe(reviewSpecs.previous.approved);

    expect(history.reviewsCompleted).toHaveLength(PERIOD_KEYS.length);
    expect(history.activeReviewsCompleted).toHaveLength(PERIOD_KEYS.length);

    history.reviewsCompleted.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value).toBe(expectedReviewsHistory[index]);
    });

    history.activeReviewsCompleted.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value).toBe(expectedActiveHistory[index]);
    });
  });
});
