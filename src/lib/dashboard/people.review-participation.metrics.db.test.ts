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

/** [requested, responded] counts per PR */
type ParticipationSpec = { requested: number; responded: number }[];

describe("people review participation metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("computes responded/requested ratio for the person", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const prAuthor: DbActor = {
      id: "participation-author",
      login: "participation-author",
      name: "Participation Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(prAuthor);

    const specs: Record<(typeof PERIOD_KEYS)[number], ParticipationSpec> = {
      previous4: [{ requested: 1, responded: 1 }, { requested: 1, responded: 0 }],
      previous3: [{ requested: 1, responded: 1 }],
      previous2: [{ requested: 1, responded: 1 }, { requested: 1, responded: 1 }],
      previous: [{ requested: 1, responded: 0 }, { requested: 1, responded: 1 }],
      current: [
        { requested: 1, responded: 1 },
        { requested: 1, responded: 1 },
        { requested: 1, responded: 0 },
      ],
    } as const;

    let prNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const prSpecs = specs[period];
      for (let index = 0; index < prSpecs.length; index += 1) {
        const { requested, responded } = prSpecs[index];
        const mergedAt = shiftHours(start, 14 + index * 6);
        const createdAt = shiftHours(mergedAt, -48);
        const prId = `${period}-participation-pr-${index}`;

        const pullRequest: DbPullRequest = {
          id: prId,
          number: prNumber,
          repositoryId: repository.id,
          authorId: prAuthor.id,
          title: `Participation PR ${prNumber}`,
          state: "MERGED",
          createdAt,
          updatedAt: mergedAt,
          closedAt: mergedAt,
          mergedAt,
          merged: true,
          raw: { title: `Participation ${prNumber}` },
        };
        prNumber += 1;
        await upsertPullRequest(pullRequest);

        if (requested > 0) {
          const reviewRequest: DbReviewRequest = {
            id: `${prId}-rr-actor`,
            pullRequestId: prId,
            reviewerId: actor.id,
            requestedAt: shiftHours(mergedAt, -6),
            raw: {},
          };
          await upsertReviewRequest(reviewRequest);
        }

        if (responded > 0) {
          const review: DbReview = {
            id: `${prId}-review-actor`,
            pullRequestId: prId,
            authorId: actor.id,
            state: "APPROVED",
            submittedAt: shiftHours(mergedAt, -2),
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
    const metric = individual.metrics.reviewParticipation;
    const history = individual.metricHistory.reviewParticipation;

    const ratioFor = (prSpecs: ParticipationSpec) => {
      const totalRequested = prSpecs.reduce((sum, s) => sum + s.requested, 0);
      const totalResponded = prSpecs.reduce((sum, s) => sum + s.responded, 0);
      return totalRequested > 0 ? totalResponded / totalRequested : null;
    };

    const expectedHistory = PERIOD_KEYS.map((period) => ratioFor(specs[period]));

    const expectedCurrent = ratioFor(specs.current) ?? 0;
    const expectedPrevious = ratioFor(specs.previous) ?? 0;

    expect(metric.current).toBeCloseTo(expectedCurrent, 5);
    expect(metric.previous).toBeCloseTo(expectedPrevious, 5);
    expect(metric.absoluteChange).toBeCloseTo(
      expectedCurrent - expectedPrevious,
      5,
    );

    expect(history).toHaveLength(PERIOD_KEYS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      const expected = expectedHistory[index];
      if (expected == null) {
        expect(entry.value).toBeNull();
      } else {
        expect(entry.value ?? Number.NaN).toBeCloseTo(expected, 5);
      }
    });
  });
});
