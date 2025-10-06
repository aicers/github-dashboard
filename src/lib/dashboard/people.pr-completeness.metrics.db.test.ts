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

type FeedbackSpec = {
  commented: number;
  changesRequested: number;
};

describe("people PR completeness metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("derives feedback ratios and breakdowns for merged PRs", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const reviewerA: DbActor = {
      id: "reviewer-a",
      login: "reviewer-a",
      name: "Reviewer A",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewerB: DbActor = {
      id: "reviewer-b",
      login: "reviewer-b",
      name: "Reviewer B",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await Promise.all([upsertUser(reviewerA), upsertUser(reviewerB)]);

    const specs: Record<(typeof PERIOD_KEYS)[number], FeedbackSpec[]> = {
      previous4: [{ commented: 1, changesRequested: 0 }],
      previous3: [
        { commented: 1, changesRequested: 1 },
        { commented: 0, changesRequested: 1 },
      ],
      previous2: [{ commented: 2, changesRequested: 0 }],
      previous: [
        { commented: 1, changesRequested: 0 },
        { commented: 2, changesRequested: 1 },
        { commented: 0, changesRequested: 1 },
      ],
      current: [
        { commented: 2, changesRequested: 1 },
        { commented: 1, changesRequested: 2 },
      ],
    } as const;

    let prNumber = 1;
    const reviewers = [reviewerA, reviewerB];
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const feedbackList = specs[period];
      for (let index = 0; index < feedbackList.length; index += 1) {
        const feedback = feedbackList[index];
        const mergedAt = shiftHours(start, 24 + index * 8);
        const createdAt = shiftHours(mergedAt, -48);
        const prId = `${period}-pr-${index}`;
        const pullRequest: DbPullRequest = {
          id: prId,
          number: prNumber,
          repositoryId: repository.id,
          authorId: actor.id,
          title: `Completeness PR ${prNumber}`,
          state: "MERGED",
          createdAt,
          updatedAt: mergedAt,
          closedAt: mergedAt,
          mergedAt,
          merged: true,
          raw: { title: `Completeness ${prNumber}` },
        };
        prNumber += 1;
        await upsertPullRequest(pullRequest);

        let reviewSequence = 0;
        const createReview = async (
          state: "COMMENTED" | "CHANGES_REQUESTED",
        ) => {
          const reviewer =
            reviewers[(index + reviewSequence) % reviewers.length];
          const submittedAt = shiftHours(mergedAt, -2 - reviewSequence);
          const review: DbReview = {
            id: `${prId}-review-${reviewSequence}`,
            pullRequestId: prId,
            authorId: reviewer.id,
            state,
            submittedAt,
            raw: { state },
          };
          reviewSequence += 1;
          await upsertReview(review);
        };

        for (let i = 0; i < feedback.commented; i += 1) {
          await createReview("COMMENTED");
        }
        for (let i = 0; i < feedback.changesRequested; i += 1) {
          await createReview("CHANGES_REQUESTED");
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
    const metric = individual.metrics.prCompleteness;
    const history = individual.metricHistory.prCompleteness;

    const ratioFor = (entries: FeedbackSpec[]) => {
      if (!entries.length) {
        return 0;
      }
      const totalFeedback = entries.reduce(
        (acc, value) => acc + value.commented + value.changesRequested,
        0,
      );
      return totalFeedback / entries.length;
    };

    const expectedHistory = PERIOD_KEYS.map((period) =>
      ratioFor(specs[period]),
    );

    const currentRatio = ratioFor(specs.current);
    const previousRatio = ratioFor(specs.previous);

    expect(metric.current).toBeCloseTo(currentRatio, 5);
    expect(metric.previous).toBeCloseTo(previousRatio, 5);
    expect(metric.absoluteChange).toBeCloseTo(currentRatio - previousRatio, 5);

    const breakdown = metric.breakdown ?? [];
    expect(breakdown).toHaveLength(3);

    const findEntry = (label: string) =>
      breakdown.find((entry) => entry.label === label) ?? {
        current: Number.NaN,
        previous: Number.NaN,
      };

    const mergedEntry = findEntry("PR 머지");
    expect(mergedEntry.current).toBe(specs.current.length);
    expect(mergedEntry.previous).toBe(specs.previous.length);

    const commentedEntry = findEntry("COMMENTED");
    expect(commentedEntry.current).toBe(
      specs.current.reduce((acc, spec) => acc + spec.commented, 0),
    );
    expect(commentedEntry.previous).toBe(
      specs.previous.reduce((acc, spec) => acc + spec.commented, 0),
    );

    const changesEntry = findEntry("CHANGES_REQUESTED");
    expect(changesEntry.current).toBe(
      specs.current.reduce((acc, spec) => acc + spec.changesRequested, 0),
    );
    expect(changesEntry.previous).toBe(
      specs.previous.reduce((acc, spec) => acc + spec.changesRequested, 0),
    );

    expect(history).toHaveLength(PERIOD_KEYS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value ?? Number.NaN).toBeCloseTo(expectedHistory[index], 5);
    });
  });
});
