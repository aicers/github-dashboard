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

type CoverageSpec = {
  merged: number;
  reviewed: number;
};

describe("people PR review coverage metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("computes coverage ratios for reviewed merged PRs", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const prAuthor: DbActor = {
      id: "coverage-author",
      login: "coverage-author",
      name: "Coverage Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(prAuthor);

    const coverageSpecs: Record<(typeof PERIOD_KEYS)[number], CoverageSpec> = {
      previous4: { merged: 2, reviewed: 1 },
      previous3: { merged: 3, reviewed: 2 },
      previous2: { merged: 2, reviewed: 2 },
      previous: { merged: 4, reviewed: 3 },
      current: { merged: 5, reviewed: 4 },
    } as const;

    let prNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const { merged, reviewed } = coverageSpecs[period];
      for (let index = 0; index < merged; index += 1) {
        const mergedAt = shiftHours(start, 12 + index * 6);
        const createdAt = shiftHours(mergedAt, -24);
        const prId = `${period}-coverage-pr-${index}`;

        const pullRequest: DbPullRequest = {
          id: prId,
          number: prNumber,
          repositoryId: repository.id,
          authorId: prAuthor.id,
          title: `Coverage PR ${prNumber}`,
          state: "MERGED",
          createdAt,
          updatedAt: mergedAt,
          closedAt: mergedAt,
          mergedAt,
          merged: true,
          raw: { title: `Coverage ${prNumber}` },
        };
        prNumber += 1;
        await upsertPullRequest(pullRequest);

        if (index < reviewed) {
          const submittedAt = shiftHours(mergedAt, -2);
          const review: DbReview = {
            id: `${prId}-review-${index}`,
            pullRequestId: prId,
            authorId: actor.id,
            state: "APPROVED",
            submittedAt,
            raw: { state: "APPROVED" },
          };
          await upsertReview(review);
        }
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
    const metric = individual.metrics.reviewCoverage;
    const history = individual.metricHistory.reviewCoverage;

    const ratioFor = ({ merged, reviewed }: CoverageSpec) => reviewed / merged;

    const expectedHistory = PERIOD_KEYS.map((period) =>
      ratioFor(coverageSpecs[period]),
    );

    expect(metric.current).toBeCloseTo(ratioFor(coverageSpecs.current), 5);
    expect(metric.previous).toBeCloseTo(ratioFor(coverageSpecs.previous), 5);
    expect(metric.absoluteChange).toBeCloseTo(
      ratioFor(coverageSpecs.current) - ratioFor(coverageSpecs.previous),
      5,
    );

    expect(history).toHaveLength(PERIOD_KEYS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value ?? Number.NaN).toBeCloseTo(expectedHistory[index], 5);
    });
  });
});
