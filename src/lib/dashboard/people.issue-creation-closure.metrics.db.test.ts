// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { type DbIssue, upsertIssue } from "@/lib/db/operations";
import {
  buildPeriodRanges,
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
  seedPersonAndRepo,
  shiftHours,
} from "../../../tests/helpers/dashboard-metrics";

describe("people issue creation and closure metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("calculates issue creation and closure counts with historical series", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const creationCounts = {
      previous4: 1,
      previous3: 2,
      previous2: 2,
      previous: 3,
      current: 4,
    } as const;
    const closureCounts = {
      previous4: 1,
      previous3: 1,
      previous2: 2,
      previous: 1,
      current: 3,
    } as const;

    let issueNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      for (let index = 0; index < creationCounts[period]; index += 1) {
        const createdAt = shiftHours(start, 2 + index * 3);
        const closed = index < closureCounts[period];
        const closedAt = closed ? shiftHours(createdAt, 6) : null;
        const issue: DbIssue = {
          id: `${period}-issue-${index + 1}`,
          number: issueNumber,
          repositoryId: repository.id,
          authorId: actor.id,
          title: `Issue ${issueNumber}`,
          state: closed ? "CLOSED" : "OPEN",
          createdAt,
          updatedAt: closedAt ?? createdAt,
          closedAt,
          raw: { title: `Issue ${issueNumber}` },
        };
        issueNumber += 1;
        await upsertIssue(issue);
      }
    }

    await upsertIssue({
      id: "outside-issue",
      number: 999,
      repositoryId: repository.id,
      authorId: actor.id,
      title: "Outside issue",
      state: "OPEN",
      createdAt: "2023-10-01T00:00:00.000Z",
      updatedAt: "2023-10-01T00:00:00.000Z",
      closedAt: null,
      raw: { title: "Outside issue" },
    });

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

    const expectedCreationHistory = PERIOD_KEYS.map(
      (key) => creationCounts[key],
    );
    const expectedClosureHistory = PERIOD_KEYS.map((key) => closureCounts[key]);

    const creationMetric = metrics.issuesCreated;
    expect(creationMetric.current).toBe(creationCounts.current);
    expect(creationMetric.previous).toBe(creationCounts.previous);
    expect(creationMetric.absoluteChange).toBe(
      creationCounts.current - creationCounts.previous,
    );
    if (creationCounts.previous > 0) {
      const expectedPercent =
        ((creationCounts.current - creationCounts.previous) /
          creationCounts.previous) *
        100;
      expect(creationMetric.percentChange).not.toBeNull();
      expect(creationMetric.percentChange ?? 0).toBeCloseTo(expectedPercent, 5);
    } else {
      expect(creationMetric.percentChange).toBeNull();
    }

    const closureMetric = metrics.issuesClosed;
    expect(closureMetric.current).toBe(closureCounts.current);
    expect(closureMetric.previous).toBe(closureCounts.previous);
    expect(closureMetric.absoluteChange).toBe(
      closureCounts.current - closureCounts.previous,
    );
    if (closureCounts.previous > 0) {
      const expectedPercent =
        ((closureCounts.current - closureCounts.previous) /
          closureCounts.previous) *
        100;
      expect(closureMetric.percentChange).not.toBeNull();
      expect(closureMetric.percentChange ?? 0).toBeCloseTo(expectedPercent, 5);
    } else {
      expect(closureMetric.percentChange).toBeNull();
    }

    const createdHistory = history.issuesCreated;
    const closedHistory = history.issuesClosed;

    expect(createdHistory).toHaveLength(PERIOD_KEYS.length);
    expect(closedHistory).toHaveLength(PERIOD_KEYS.length);

    createdHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value).toBe(expectedCreationHistory[index]);
    });

    closedHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value).toBe(expectedClosureHistory[index]);
    });
  });
});
