// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbPullRequest,
  upsertPullRequest,
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

describe("people PR creation, merge, and merge-by metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("tracks authored and merged pull request counts across history", async () => {
    const { actor, repository } = await seedPersonAndRepo();

    const merger: DbActor = {
      id: "reviewer-user",
      login: "reviewer-user",
      name: "Reviewer User",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(merger);

    const collaborator: DbActor = {
      id: "collaborator-user",
      login: "collab",
      name: "Collaborator",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(collaborator);

    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const createdCounts = {
      previous4: 1,
      previous3: 2,
      previous2: 3,
      previous: 2,
      current: 4,
    } as const;
    const mergedCounts = {
      previous4: 1,
      previous3: 1,
      previous2: 2,
      previous: 1,
      current: 3,
    } as const;
    const mergedByCounts = {
      previous4: 1,
      previous3: 2,
      previous2: 1,
      previous: 2,
      current: 3,
    } as const;

    let pullRequestNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];

      for (let index = 0; index < createdCounts[period]; index += 1) {
        const createdAt = shiftHours(start, 4 + index * 6);
        const merged = index < mergedCounts[period];
        const mergedAt = merged ? shiftHours(createdAt, 10) : null;
        const pullRequest: DbPullRequest = {
          id: `${period}-pr-${index}`,
          number: pullRequestNumber,
          repositoryId: repository.id,
          authorId: actor.id,
          title: `PR ${pullRequestNumber}`,
          state: merged ? "MERGED" : "OPEN",
          createdAt,
          updatedAt: mergedAt ?? createdAt,
          closedAt: mergedAt,
          mergedAt,
          merged,
          raw: {
            title: `PR ${pullRequestNumber}`,
            mergedBy: merged ? { id: merger.id } : null,
          },
        };
        pullRequestNumber += 1;
        await upsertPullRequest(pullRequest);
      }

      for (let index = 0; index < mergedByCounts[period]; index += 1) {
        const createdAt = shiftHours(start, 12 + index * 5);
        const mergedAt = shiftHours(createdAt, 8);
        const pullRequest: DbPullRequest = {
          id: `${period}-merged-by-${index}`,
          number: pullRequestNumber,
          repositoryId: repository.id,
          authorId: collaborator.id,
          title: `Merged by ${actor.login} ${pullRequestNumber}`,
          state: "MERGED",
          createdAt,
          updatedAt: mergedAt,
          closedAt: mergedAt,
          mergedAt,
          merged: true,
          raw: {
            mergedBy: { id: actor.id },
            title: `Merged by ${actor.login}`,
          },
        };
        pullRequestNumber += 1;
        await upsertPullRequest(pullRequest);
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

    const createdHistory = PERIOD_KEYS.map((period) => createdCounts[period]);
    const mergedHistory = PERIOD_KEYS.map((period) => mergedCounts[period]);
    const mergedByHistory = PERIOD_KEYS.map((period) => mergedByCounts[period]);

    const createdMetric = metrics.prsCreated;
    expect(createdMetric.current).toBe(createdCounts.current);
    expect(createdMetric.previous).toBe(createdCounts.previous);

    const mergedMetric = metrics.prsMerged;
    expect(mergedMetric.current).toBe(mergedCounts.current);
    expect(mergedMetric.previous).toBe(mergedCounts.previous);

    const mergedByMetric = metrics.prsMergedBy;
    expect(mergedByMetric.current).toBe(mergedByCounts.current);
    expect(mergedByMetric.previous).toBe(mergedByCounts.previous);

    const historyChecks: Array<{
      actual: { period: string; value: number | null }[];
      expected: number[];
    }> = [
      { actual: history.prsCreated, expected: createdHistory },
      { actual: history.prsMerged, expected: mergedHistory },
      { actual: history.prsMergedBy, expected: mergedByHistory },
    ];

    historyChecks.forEach(({ actual, expected }) => {
      expect(actual).toHaveLength(PERIOD_KEYS.length);
      actual.forEach((entry, index) => {
        expect(entry.period).toBe(PERIOD_KEYS[index]);
        expect(entry.value).toBe(expected[index]);
      });
    });
  });
});
