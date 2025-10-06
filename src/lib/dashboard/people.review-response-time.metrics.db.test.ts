// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbPullRequest,
  type DbReview,
  type DbReviewRequest,
  upsertPullRequest,
  upsertReview,
  upsertReviewRequest,
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

describe("people review response time metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("averages business-hour response times per period", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const prAuthor: DbActor = {
      id: "response-author",
      login: "response-author",
      name: "Response Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(prAuthor);

    const responseDurations: Record<(typeof PERIOD_KEYS)[number], number[]> = {
      previous4: [10, 6],
      previous3: [8],
      previous2: [6, 4],
      previous: [7, 5],
      current: [4, 3, 6],
    } as const;

    let prNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const durations = responseDurations[period];
      for (let index = 0; index < durations.length; index += 1) {
        const createdAt = shiftHours(start, 9 + index * 5);
        const pullRequestId = `${period}-response-pr-${index}`;
        const pullRequest: DbPullRequest = {
          id: pullRequestId,
          number: prNumber,
          repositoryId: repository.id,
          authorId: prAuthor.id,
          title: `Response PR ${prNumber}`,
          state: "OPEN",
          createdAt,
          updatedAt: createdAt,
          closedAt: null,
          mergedAt: null,
          merged: false,
          raw: { title: `Response ${prNumber}` },
        };
        prNumber += 1;
        await upsertPullRequest(pullRequest);

        const requestedAt = shiftHours(createdAt, 2);
        const respondedAt = shiftHours(requestedAt, durations[index]);

        const request: DbReviewRequest = {
          id: `${pullRequestId}-request-${index}`,
          pullRequestId,
          reviewerId: actor.id,
          requestedAt,
          raw: { requestedAt },
        };
        await upsertReviewRequest(request);

        const review: DbReview = {
          id: `${pullRequestId}-review-${index}`,
          pullRequestId,
          authorId: actor.id,
          state: "COMMENTED",
          submittedAt: respondedAt,
          raw: { state: "COMMENTED" },
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
    const metric = individual.metrics.reviewResponseTime;
    const history = individual.metricHistory.reviewResponseTime;

    const averageFor = (values: number[]) =>
      values.reduce((acc, value) => acc + value, 0) / values.length;

    const expectedHistory = PERIOD_KEYS.map((period) =>
      averageFor(responseDurations[period]),
    );

    expect(metric.unit).toBe("hours");
    expect(metric.current).toBeCloseTo(
      averageFor(responseDurations.current),
      5,
    );
    expect(metric.previous).toBeCloseTo(
      averageFor(responseDurations.previous),
      5,
    );
    expect(metric.absoluteChange).toBeCloseTo(
      averageFor(responseDurations.current) -
        averageFor(responseDurations.previous),
      5,
    );

    expect(history).toHaveLength(PERIOD_KEYS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value ?? Number.NaN).toBeCloseTo(expectedHistory[index], 5);
    });
  });
});
