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
} from "../../../tests/helpers/people-metrics";

type ParticipationSpec = number[];

describe("people review participation metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("averages reviewer counts on participated PRs", async () => {
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

    const extraReviewers: DbActor[] = Array.from({ length: 6 }).map(
      (_, index) => ({
        id: `extra-reviewer-${index}`,
        login: `extra-reviewer-${index}`,
        name: `Extra Reviewer ${index}`,
        createdAt: CURRENT_RANGE_START,
        updatedAt: CURRENT_RANGE_START,
      }),
    );
    await Promise.all(extraReviewers.map((reviewer) => upsertUser(reviewer)));

    const specs: Record<(typeof PERIOD_KEYS)[number], ParticipationSpec> = {
      previous4: [1, 2],
      previous3: [2],
      previous2: [3, 2],
      previous: [4, 3],
      current: [2, 3, 4],
    } as const;

    let prNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const counts = specs[period];
      for (let index = 0; index < counts.length; index += 1) {
        const reviewerCount = counts[index];
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

        const reviewers: DbActor[] = [actor];
        for (let idx = 0; idx < reviewerCount - 1; idx += 1) {
          reviewers.push(extraReviewers[(index + idx) % extraReviewers.length]);
        }

        for (
          let reviewerIndex = 0;
          reviewerIndex < reviewers.length;
          reviewerIndex += 1
        ) {
          const reviewer = reviewers[reviewerIndex];
          const submittedAt = shiftHours(mergedAt, -2 - reviewerIndex);
          const state = reviewer.id === actor.id ? "APPROVED" : "COMMENTED";
          const review: DbReview = {
            id: `${prId}-review-${reviewerIndex}`,
            pullRequestId: prId,
            authorId: reviewer.id,
            state,
            submittedAt,
            raw: { state },
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

    const averageFor = (values: number[]) =>
      values.reduce((acc, value) => acc + value, 0) / values.length;

    const expectedHistory = PERIOD_KEYS.map((period) =>
      averageFor(specs[period]),
    );

    expect(metric.current).toBeCloseTo(averageFor(specs.current), 5);
    expect(metric.previous).toBeCloseTo(averageFor(specs.previous), 5);
    expect(metric.absoluteChange).toBeCloseTo(
      averageFor(specs.current) - averageFor(specs.previous),
      5,
    );

    expect(history).toHaveLength(PERIOD_KEYS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value ?? Number.NaN).toBeCloseTo(expectedHistory[index], 5);
    });
  });
});
