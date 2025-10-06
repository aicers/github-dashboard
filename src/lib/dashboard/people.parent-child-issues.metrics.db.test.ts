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

type RoleKey = "parent" | "child";

type DurationSpec = {
  resolutionHours: number;
  workHours: number;
};

type PeriodDurations = Record<RoleKey, DurationSpec>;

const TARGET_PROJECT = "To-Do List";

function createDurationIssue(
  period: string,
  index: number,
  role: RoleKey,
  repositoryId: string,
  actorId: string,
  closedAt: string,
  spec: DurationSpec,
): DbIssue {
  const createdAt = shiftHours(closedAt, -spec.resolutionHours);
  const workStartedAt = shiftHours(closedAt, -spec.workHours);
  return {
    id: `${period}-${role}-${index}`,
    number: index,
    repositoryId,
    authorId: actorId,
    title: `${role}-${period}-${index}`,
    state: "CLOSED",
    createdAt,
    updatedAt: closedAt,
    closedAt,
    raw: {
      trackedIssues: { totalCount: role === "parent" ? 1 : 0 },
      trackedInIssues: { totalCount: role === "child" ? 1 : 0 },
      projectStatusHistory: [
        {
          projectTitle: TARGET_PROJECT,
          status: "In Progress",
          occurredAt: workStartedAt,
        },
        {
          projectTitle: TARGET_PROJECT,
          status: "Done",
          occurredAt: closedAt,
        },
      ],
    },
  };
}

describe("people parent and child issue metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("summarizes resolution and work hours separately for parent and child issues", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const specs: Record<(typeof PERIOD_KEYS)[number], PeriodDurations> = {
      previous4: {
        parent: { resolutionHours: 160, workHours: 96 },
        child: { resolutionHours: 120, workHours: 60 },
      },
      previous3: {
        parent: { resolutionHours: 140, workHours: 84 },
        child: { resolutionHours: 108, workHours: 54 },
      },
      previous2: {
        parent: { resolutionHours: 128, workHours: 72 },
        child: { resolutionHours: 96, workHours: 48 },
      },
      previous: {
        parent: { resolutionHours: 116, workHours: 66 },
        child: { resolutionHours: 88, workHours: 44 },
      },
      current: {
        parent: { resolutionHours: 104, workHours: 60 },
        child: { resolutionHours: 80, workHours: 40 },
      },
    } as const;

    let index = 1;
    for (const period of PERIOD_KEYS) {
      const position = PERIOD_KEYS.indexOf(period);
      const baseOffset = 32 + position * 5;
      const parentClosedAt = shiftHours(ranges[period].start, baseOffset);
      const childClosedAt = shiftHours(ranges[period].start, baseOffset + 10);

      const parentIssue = createDurationIssue(
        period,
        index,
        "parent",
        repository.id,
        actor.id,
        parentClosedAt,
        specs[period].parent,
      );
      index += 1;
      await upsertIssue(parentIssue);

      const childIssue = createDurationIssue(
        period,
        index,
        "child",
        repository.id,
        actor.id,
        childClosedAt,
        specs[period].child,
      );
      index += 1;
      await upsertIssue(childIssue);
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

    const expectedParentResolutionHistory = PERIOD_KEYS.map(
      (period) => specs[period].parent.resolutionHours,
    );
    const expectedChildResolutionHistory = PERIOD_KEYS.map(
      (period) => specs[period].child.resolutionHours,
    );
    const expectedParentWorkHistory = PERIOD_KEYS.map(
      (period) => specs[period].parent.workHours,
    );
    const expectedChildWorkHistory = PERIOD_KEYS.map(
      (period) => specs[period].child.workHours,
    );

    const parentResolution = metrics.parentIssueResolutionTime;
    const childResolution = metrics.childIssueResolutionTime;
    const parentWork = metrics.parentIssueWorkTime;
    const childWork = metrics.childIssueWorkTime;

    expect(parentResolution.unit).toBe("hours");
    expect(childResolution.unit).toBe("hours");
    expect(parentWork.unit).toBe("hours");
    expect(childWork.unit).toBe("hours");

    expect(parentResolution.current).toBeCloseTo(
      specs.current.parent.resolutionHours,
      5,
    );
    expect(parentResolution.previous).toBeCloseTo(
      specs.previous.parent.resolutionHours,
      5,
    );

    expect(childResolution.current).toBeCloseTo(
      specs.current.child.resolutionHours,
      5,
    );
    expect(childResolution.previous).toBeCloseTo(
      specs.previous.child.resolutionHours,
      5,
    );

    expect(parentWork.current).toBeCloseTo(specs.current.parent.workHours, 5);
    expect(parentWork.previous).toBeCloseTo(specs.previous.parent.workHours, 5);

    expect(childWork.current).toBeCloseTo(specs.current.child.workHours, 5);
    expect(childWork.previous).toBeCloseTo(specs.previous.child.workHours, 5);

    const historyChecks: Array<{
      series: { period: string; value: number | null }[];
      expected: number[];
    }> = [
      {
        series: history.parentIssueResolutionTime,
        expected: expectedParentResolutionHistory,
      },
      {
        series: history.childIssueResolutionTime,
        expected: expectedChildResolutionHistory,
      },
      {
        series: history.parentIssueWorkTime,
        expected: expectedParentWorkHistory,
      },
      {
        series: history.childIssueWorkTime,
        expected: expectedChildWorkHistory,
      },
    ];

    historyChecks.forEach(({ series, expected }) => {
      expect(series).toHaveLength(PERIOD_KEYS.length);
      series.forEach((entry, idx) => {
        expect(entry.period).toBe(PERIOD_KEYS[idx]);
        expect(entry.value ?? Number.NaN).toBeCloseTo(expected[idx], 5);
      });
    });
  });
});
