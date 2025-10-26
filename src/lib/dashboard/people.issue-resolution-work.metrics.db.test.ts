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

const TARGET_PROJECT = "To-Do List";
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

function createDurationIssue(
  params: {
    period: string;
    index: number;
    actorId: string;
    repositoryId: string;
    role: RoleKey;
    closedAt: string;
  } & DurationSpec,
): DbIssue {
  const {
    period,
    index,
    actorId,
    repositoryId,
    role,
    closedAt,
    resolutionHours,
    workHours,
  } = params;
  const createdAt = shiftHours(closedAt, -resolutionHours);
  const workStartedAt = shiftHours(closedAt, -workHours);
  const trackedIssues = role === "parent" ? 1 : 0;
  const trackedInIssues = role === "child" ? 1 : 0;
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
      trackedIssues: { totalCount: trackedIssues },
      trackedInIssues: { totalCount: trackedInIssues },
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

describe("people resolution and work duration metrics", () => {
  const originalTodoProjectName = env.TODO_PROJECT_NAME;

  beforeEach(async () => {
    env.TODO_PROJECT_NAME = "to-do list";
    await resetDashboardTables();
  });

  afterEach(() => {
    env.TODO_PROJECT_NAME = originalTodoProjectName;
  });

  it("aggregates resolution and work durations with per-period averages", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const specs: Record<(typeof PERIOD_KEYS)[number], PeriodDurations> = {
      previous4: {
        parent: { resolutionHours: 144, workHours: 80 },
        child: { resolutionHours: 120, workHours: 60 },
      },
      previous3: {
        parent: { resolutionHours: 132, workHours: 72 },
        child: { resolutionHours: 102, workHours: 54 },
      },
      previous2: {
        parent: { resolutionHours: 126, workHours: 68 },
        child: { resolutionHours: 96, workHours: 48 },
      },
      previous: {
        parent: { resolutionHours: 108, workHours: 60 },
        child: { resolutionHours: 84, workHours: 42 },
      },
      current: {
        parent: { resolutionHours: 96, workHours: 50 },
        child: { resolutionHours: 72, workHours: 36 },
      },
    } as const;

    const businessDurations = {} as Record<
      (typeof PERIOD_KEYS)[number],
      BusinessPeriodDurations
    >;

    let sequence = 1;
    for (const period of PERIOD_KEYS) {
      const periodIndex = PERIOD_KEYS.indexOf(period);
      const baseOffset = 36 + periodIndex * 4;
      const parentClosedAt = shiftHours(ranges[period].start, baseOffset);
      const childClosedAt = shiftHours(ranges[period].start, baseOffset + 12);

      const parentSpec = specs[period].parent;
      const childSpec = specs[period].child;

      const parentIssue = createDurationIssue({
        period,
        index: sequence,
        actorId: actor.id,
        repositoryId: repository.id,
        role: "parent",
        closedAt: parentClosedAt,
        ...parentSpec,
      });
      sequence += 1;

      const childIssue = createDurationIssue({
        period,
        index: sequence,
        actorId: actor.id,
        repositoryId: repository.id,
        role: "child",
        closedAt: childClosedAt,
        ...childSpec,
      });
      sequence += 1;

      await upsertIssue(parentIssue);
      await upsertIssue(childIssue);

      businessDurations[period] = {
        parent: {
          resolutionHours:
            calculateBusinessHoursBetween(
              shiftHours(parentClosedAt, -parentSpec.resolutionHours),
              parentClosedAt,
              EMPTY_HOLIDAY_SET,
            ) ?? Number.NaN,
          workHours:
            calculateBusinessHoursBetween(
              shiftHours(parentClosedAt, -parentSpec.workHours),
              parentClosedAt,
              EMPTY_HOLIDAY_SET,
            ) ?? Number.NaN,
        },
        child: {
          resolutionHours:
            calculateBusinessHoursBetween(
              shiftHours(childClosedAt, -childSpec.resolutionHours),
              childClosedAt,
              EMPTY_HOLIDAY_SET,
            ) ?? Number.NaN,
          workHours:
            calculateBusinessHoursBetween(
              shiftHours(childClosedAt, -childSpec.workHours),
              childClosedAt,
              EMPTY_HOLIDAY_SET,
            ) ?? Number.NaN,
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

    const resolutionHistory = PERIOD_KEYS.map((period) => {
      const { parent, child } = businessDurations[period];
      return (parent.resolutionHours + child.resolutionHours) / 2;
    });
    const workHistory = PERIOD_KEYS.map((period) => {
      const { parent, child } = businessDurations[period];
      return (parent.workHours + child.workHours) / 2;
    });

    const parentResolutionHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].parent.resolutionHours,
    );
    const childResolutionHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].child.resolutionHours,
    );
    const parentWorkHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].parent.workHours,
    );
    const childWorkHistory = PERIOD_KEYS.map(
      (period) => businessDurations[period].child.workHours,
    );

    const resolutionMetric = metrics.issueResolutionTime;
    const workMetric = metrics.issueWorkTime;

    const resolutionCurrent = resolutionHistory.at(-1) ?? Number.NaN;
    const resolutionPrevious = resolutionHistory.at(-2) ?? Number.NaN;
    const workCurrent = workHistory.at(-1) ?? Number.NaN;
    const workPrevious = workHistory.at(-2) ?? Number.NaN;

    expect(resolutionMetric.unit).toBe("hours");
    expect(workMetric.unit).toBe("hours");

    expect(resolutionMetric.current).toBeCloseTo(resolutionCurrent, 5);
    expect(resolutionMetric.previous).toBeCloseTo(resolutionPrevious, 5);
    expect(resolutionMetric.absoluteChange).toBeCloseTo(
      resolutionCurrent - resolutionPrevious,
      5,
    );

    expect(workMetric.current).toBeCloseTo(workCurrent, 5);
    expect(workMetric.previous).toBeCloseTo(workPrevious, 5);
    expect(workMetric.absoluteChange).toBeCloseTo(
      workCurrent - workPrevious,
      5,
    );

    const parentResolutionMetric = metrics.parentIssueResolutionTime;
    const childResolutionMetric = metrics.childIssueResolutionTime;
    const parentWorkMetric = metrics.parentIssueWorkTime;
    const childWorkMetric = metrics.childIssueWorkTime;

    expect(parentResolutionMetric.current).toBeCloseTo(
      businessDurations.current.parent.resolutionHours,
      5,
    );
    expect(childResolutionMetric.current).toBeCloseTo(
      businessDurations.current.child.resolutionHours,
      5,
    );
    expect(parentWorkMetric.current).toBeCloseTo(
      businessDurations.current.parent.workHours,
      5,
    );
    expect(childWorkMetric.current).toBeCloseTo(
      businessDurations.current.child.workHours,
      5,
    );

    const historyChecks: Array<{
      series: { period: string; value: number | null }[];
      expected: number[];
    }> = [
      { series: history.issueResolutionTime, expected: resolutionHistory },
      { series: history.issueWorkTime, expected: workHistory },
      {
        series: history.parentIssueResolutionTime,
        expected: parentResolutionHistory,
      },
      {
        series: history.childIssueResolutionTime,
        expected: childResolutionHistory,
      },
      { series: history.parentIssueWorkTime, expected: parentWorkHistory },
      { series: history.childIssueWorkTime, expected: childWorkHistory },
    ];

    historyChecks.forEach(({ series, expected }) => {
      expect(series).toHaveLength(PERIOD_KEYS.length);
      series.forEach((entry, index) => {
        expect(entry.period).toBe(PERIOD_KEYS[index]);
        expect(entry.value ?? Number.NaN).toBeCloseTo(expected[index], 5);
      });
    });
  });
});
