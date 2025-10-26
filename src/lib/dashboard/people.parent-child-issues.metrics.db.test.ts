// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  calculateBusinessHoursBetween,
  EMPTY_HOLIDAY_SET,
} from "@/lib/dashboard/business-days";
import { type DbIssue, upsertIssue } from "@/lib/db/operations";
import { env } from "@/lib/env";
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

type BusinessDuration = {
  resolutionHours: number;
  workHours: number;
};

type BusinessPeriodDurations = Record<RoleKey, BusinessDuration>;

const TARGET_PROJECT = "To-Do List";

function calculateBusinessHoursForDuration(
  closedAt: string,
  hours: number,
): number {
  return (
    calculateBusinessHoursBetween(
      shiftHours(closedAt, -hours),
      closedAt,
      EMPTY_HOLIDAY_SET,
    ) ?? Number.NaN
  );
}

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
  const originalTodoProjectName = env.TODO_PROJECT_NAME;

  beforeEach(async () => {
    env.TODO_PROJECT_NAME = "to-do list";
    await resetDashboardTables();
  });

  afterEach(() => {
    env.TODO_PROJECT_NAME = originalTodoProjectName;
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

    const businessDurations = {} as Record<
      (typeof PERIOD_KEYS)[number],
      BusinessPeriodDurations
    >;

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

      businessDurations[period] = {
        parent: {
          resolutionHours: calculateBusinessHoursForDuration(
            parentClosedAt,
            specs[period].parent.resolutionHours,
          ),
          workHours: calculateBusinessHoursForDuration(
            parentClosedAt,
            specs[period].parent.workHours,
          ),
        },
        child: {
          resolutionHours: calculateBusinessHoursForDuration(
            childClosedAt,
            specs[period].child.resolutionHours,
          ),
          workHours: calculateBusinessHoursForDuration(
            childClosedAt,
            specs[period].child.workHours,
          ),
        },
      };
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
      (period) => businessDurations[period].parent.resolutionHours,
    );
    const expectedChildResolutionHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].child.resolutionHours,
    );
    const expectedParentWorkHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].parent.workHours,
    );
    const expectedChildWorkHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].child.workHours,
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
      businessDurations.current.parent.resolutionHours,
      5,
    );
    expect(parentResolution.previous).toBeCloseTo(
      businessDurations.previous.parent.resolutionHours,
      5,
    );

    expect(childResolution.current).toBeCloseTo(
      businessDurations.current.child.resolutionHours,
      5,
    );
    expect(childResolution.previous).toBeCloseTo(
      businessDurations.previous.child.resolutionHours,
      5,
    );

    expect(parentWork.current).toBeCloseTo(
      businessDurations.current.parent.workHours,
      5,
    );
    expect(parentWork.previous).toBeCloseTo(
      businessDurations.previous.parent.workHours,
      5,
    );

    expect(childWork.current).toBeCloseTo(
      businessDurations.current.child.workHours,
      5,
    );
    expect(childWork.previous).toBeCloseTo(
      businessDurations.previous.child.workHours,
      5,
    );

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
