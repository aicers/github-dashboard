// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  calculateBusinessHoursBetween,
  EMPTY_HOLIDAY_SET,
} from "@/lib/dashboard/business-days";
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  type PeriodKey,
  resetDashboardTables,
  shiftHours,
} from "../../../tests/helpers/dashboard-metrics";
import { formatMetricSnapshotForTest } from "../../../tests/helpers/metric-formatting";

const TARGET_PROJECT = "To-Do List";
const PERIODS = PERIOD_KEYS;
type RoleKey = "parent" | "child";

type DurationSpec = {
  closedAt: string;
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
  repository: DbRepository,
  role: RoleKey,
  sequence: number,
  spec: DurationSpec,
): DbIssue {
  const { closedAt, resolutionHours, workHours } = spec;
  const createdAt = shiftHours(closedAt, -resolutionHours);
  const workStartedAt = shiftHours(closedAt, -workHours);

  const trackedIssues = role === "parent" ? 1 : 0;
  const trackedInIssues = role === "child" ? 1 : 0;

  return {
    id: `${repository.id}-${role}-${sequence}`,
    number: sequence,
    repositoryId: repository.id,
    authorId: null,
    title: `${role} issue ${sequence}`,
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

function calculateAverage(values: number[]): number {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  const total = finiteValues.reduce((acc, value) => acc + value, 0);
  return finiteValues.length ? total / finiteValues.length : Number.NaN;
}

describe("analytics issue resolution and work metrics", () => {
  const originalTodoProjectName = env.TODO_PROJECT_NAME;

  beforeEach(async () => {
    env.TODO_PROJECT_NAME = "to-do list";
    await resetDashboardTables();
  });

  afterEach(() => {
    env.TODO_PROJECT_NAME = originalTodoProjectName;
  });

  it("builds resolution and work metrics with historical breakdown", async () => {
    const actor: DbActor = {
      id: "duration-actor",
      login: "duration-user",
      name: "Duration User",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "duration-repo",
      name: "duration-repo",
      nameWithOwner: "octo/duration-repo",
      ownerId: actor.id,
      raw: { id: "duration-repo" },
    };
    await upsertRepository(repository);

    const specs: Record<PeriodKey, PeriodDurations> = {
      previous4: {
        parent: {
          closedAt: "2023-12-08T15:00:00.000Z",
          resolutionHours: 150,
          workHours: 84,
        },
        child: {
          closedAt: "2023-12-09T11:00:00.000Z",
          resolutionHours: 120,
          workHours: 60,
        },
      },
      previous3: {
        parent: {
          closedAt: "2023-12-15T12:00:00.000Z",
          resolutionHours: 132,
          workHours: 72,
        },
        child: {
          closedAt: "2023-12-14T18:00:00.000Z",
          resolutionHours: 108,
          workHours: 54,
        },
      },
      previous2: {
        parent: {
          closedAt: "2023-12-22T09:00:00.000Z",
          resolutionHours: 120,
          workHours: 66,
        },
        child: {
          closedAt: "2023-12-20T17:00:00.000Z",
          resolutionHours: 96,
          workHours: 48,
        },
      },
      previous: {
        parent: {
          closedAt: "2023-12-29T14:00:00.000Z",
          resolutionHours: 108,
          workHours: 60,
        },
        child: {
          closedAt: "2023-12-30T10:00:00.000Z",
          resolutionHours: 84,
          workHours: 42,
        },
      },
      current: {
        parent: {
          closedAt: "2024-01-05T13:00:00.000Z",
          resolutionHours: 96,
          workHours: 48,
        },
        child: {
          closedAt: "2024-01-04T18:00:00.000Z",
          resolutionHours: 72,
          workHours: 36,
        },
      },
    };

    const businessDurations: Record<PeriodKey, BusinessPeriodDurations> =
      Object.fromEntries(
        PERIODS.map((period) => [
          period,
          {
            parent: convertToBusinessDurations(specs[period].parent),
            child: convertToBusinessDurations(specs[period].child),
          },
        ]),
      ) as Record<PeriodKey, BusinessPeriodDurations>;

    let issueNumber = 1;
    for (const period of PERIODS) {
      for (const role of ["parent", "child"] as const) {
        await upsertIssue(
          createDurationIssue(
            repository,
            role,
            issueNumber++,
            specs[period][role],
          ),
        );
      }
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const metrics = analytics.organization.metrics;
    const history = analytics.organization.metricHistory;

    const expectedResolutionHistory = PERIODS.map((period) => {
      const { parent, child } = businessDurations[period];
      return calculateAverage([parent.resolutionHours, child.resolutionHours]);
    });
    const expectedWorkHistory = PERIODS.map((period) => {
      const { parent, child } = businessDurations[period];
      return calculateAverage([parent.workHours, child.workHours]);
    });
    const expectedParentResolutionHistory = PERIODS.map(
      (period) => businessDurations[period].parent.resolutionHours,
    );
    const expectedChildResolutionHistory = PERIODS.map(
      (period) => businessDurations[period].child.resolutionHours,
    );
    const expectedParentWorkHistory = PERIODS.map(
      (period) => businessDurations[period].parent.workHours,
    );
    const expectedChildWorkHistory = PERIODS.map(
      (period) => businessDurations[period].child.workHours,
    );

    const expectedResolutionCurrent =
      expectedResolutionHistory.at(-1) ?? Number.NaN;
    const expectedResolutionPrevious =
      expectedResolutionHistory.at(-2) ?? Number.NaN;
    const expectedWorkCurrent = expectedWorkHistory.at(-1) ?? Number.NaN;
    const expectedWorkPrevious = expectedWorkHistory.at(-2) ?? Number.NaN;

    expect(metrics.issueResolutionTime.current).toBeCloseTo(
      expectedResolutionCurrent,
      5,
    );
    expect(metrics.issueResolutionTime.previous).toBeCloseTo(
      expectedResolutionPrevious,
      5,
    );
    expect(metrics.issueResolutionTime.absoluteChange).toBeCloseTo(
      expectedResolutionCurrent - expectedResolutionPrevious,
      5,
    );

    expect(metrics.issueWorkTime.current).toBeCloseTo(expectedWorkCurrent, 5);
    expect(metrics.issueWorkTime.previous).toBeCloseTo(expectedWorkPrevious, 5);
    expect(metrics.issueWorkTime.absoluteChange).toBeCloseTo(
      expectedWorkCurrent - expectedWorkPrevious,
      5,
    );

    expect(metrics.parentIssueResolutionTime.current).toBeCloseTo(
      businessDurations.current.parent.resolutionHours,
      5,
    );
    expect(metrics.childIssueResolutionTime.current).toBeCloseTo(
      businessDurations.current.child.resolutionHours,
      5,
    );
    expect(metrics.parentIssueWorkTime.current).toBeCloseTo(
      businessDurations.current.parent.workHours,
      5,
    );
    expect(metrics.childIssueWorkTime.current).toBeCloseTo(
      businessDurations.current.child.workHours,
      5,
    );

    const historyChecks: Array<{
      actual: { period: string; value: number | null }[];
      expectedValues: number[];
    }> = [
      {
        actual: history.issueResolutionTime,
        expectedValues: expectedResolutionHistory,
      },
      { actual: history.issueWorkTime, expectedValues: expectedWorkHistory },
      {
        actual: history.parentIssueResolutionTime,
        expectedValues: expectedParentResolutionHistory,
      },
      {
        actual: history.childIssueResolutionTime,
        expectedValues: expectedChildResolutionHistory,
      },
      {
        actual: history.parentIssueWorkTime,
        expectedValues: expectedParentWorkHistory,
      },
      {
        actual: history.childIssueWorkTime,
        expectedValues: expectedChildWorkHistory,
      },
    ];

    for (const { actual, expectedValues } of historyChecks) {
      expect(actual).toHaveLength(PERIODS.length);
      actual.forEach((entry, index) => {
        expect(entry.period).toBe(PERIODS[index]);
        expect(entry.value).not.toBeNull();
        expect(entry.value ?? Number.NaN).toBeCloseTo(expectedValues[index], 5);
      });
    }

    const resolutionMetric = metrics.issueResolutionTime;
    const expectedResolutionSnapshot = formatMetricSnapshotForTest(
      {
        current: expectedResolutionCurrent,
        absoluteChange: expectedResolutionCurrent - expectedResolutionPrevious,
        percentChange:
          expectedResolutionPrevious === 0
            ? null
            : ((expectedResolutionCurrent - expectedResolutionPrevious) /
                expectedResolutionPrevious) *
              100,
        unit: resolutionMetric.unit,
      },
      "hours",
    );
    const resolutionSnapshot = formatMetricSnapshotForTest(
      resolutionMetric,
      "hours",
    );
    expect(resolutionSnapshot.valueLabel).toBe(
      expectedResolutionSnapshot.valueLabel,
    );
    expect(
      `${resolutionSnapshot.changeLabel} (${resolutionSnapshot.percentLabel})`,
    ).toBe(
      `${expectedResolutionSnapshot.changeLabel} (${expectedResolutionSnapshot.percentLabel})`,
    );

    const workMetric = metrics.issueWorkTime;
    const expectedWorkSnapshot = formatMetricSnapshotForTest(
      {
        current: expectedWorkCurrent,
        absoluteChange: expectedWorkCurrent - expectedWorkPrevious,
        percentChange:
          expectedWorkPrevious === 0
            ? null
            : ((expectedWorkCurrent - expectedWorkPrevious) /
                expectedWorkPrevious) *
              100,
        unit: workMetric.unit,
      },
      "hours",
    );
    const workSnapshot = formatMetricSnapshotForTest(workMetric, "hours");
    expect(workSnapshot.valueLabel).toBe(expectedWorkSnapshot.valueLabel);
    expect(`${workSnapshot.changeLabel} (${workSnapshot.percentLabel})`).toBe(
      `${expectedWorkSnapshot.changeLabel} (${expectedWorkSnapshot.percentLabel})`,
    );
  });

  it("reports null percent change when previous durations are zero", async () => {
    const actor: DbActor = {
      id: "zero-duration-actor",
      login: "zero-duration-user",
      name: "Zero Duration",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "zero-duration-repo",
      name: "zero-duration-repo",
      nameWithOwner: "octo/zero-duration-repo",
      ownerId: actor.id,
      raw: { id: "zero-duration-repo" },
    };
    await upsertRepository(repository);

    let issueNumber = 1;

    const zeroSpec: DurationSpec = {
      closedAt: "2023-12-30T12:00:00.000Z",
      resolutionHours: 0,
      workHours: 0,
    };

    await upsertIssue(
      createDurationIssue(repository, "parent", issueNumber++, zeroSpec),
    );
    await upsertIssue(
      createDurationIssue(repository, "child", issueNumber++, zeroSpec),
    );

    const currentSpecs: PeriodDurations = {
      parent: {
        closedAt: "2024-01-05T10:00:00.000Z",
        resolutionHours: 72,
        workHours: 36,
      },
      child: {
        closedAt: "2024-01-04T09:00:00.000Z",
        resolutionHours: 96,
        workHours: 48,
      },
    };

    await upsertIssue(
      createDurationIssue(
        repository,
        "parent",
        issueNumber++,
        currentSpecs.parent,
      ),
    );
    await upsertIssue(
      createDurationIssue(
        repository,
        "child",
        issueNumber++,
        currentSpecs.child,
      ),
    );

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const resolutionMetric = analytics.organization.metrics.issueResolutionTime;
    const workMetric = analytics.organization.metrics.issueWorkTime;

    expect(resolutionMetric.previous).toBe(0);
    expect(workMetric.previous).toBe(0);
    expect(resolutionMetric.percentChange).toBeNull();
    expect(workMetric.percentChange).toBeNull();
  });

  it("excludes other repositories when a filter is applied", async () => {
    const actor: DbActor = {
      id: "duration-filter-actor",
      login: "duration-filter",
      name: "Duration Filter",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const primaryRepo: DbRepository = {
      id: "duration-filter-primary",
      name: "duration-filter-primary",
      nameWithOwner: "octo/duration-filter-primary",
      ownerId: actor.id,
      raw: { id: "duration-filter-primary" },
    };
    await upsertRepository(primaryRepo);

    const secondaryRepo: DbRepository = {
      id: "duration-filter-secondary",
      name: "duration-filter-secondary",
      nameWithOwner: "octo/duration-filter-secondary",
      ownerId: actor.id,
      raw: { id: "duration-filter-secondary" },
    };
    await upsertRepository(secondaryRepo);

    let issueNumber = 1;

    const primarySpecs: PeriodDurations = {
      parent: {
        closedAt: "2024-01-03T08:00:00.000Z",
        resolutionHours: 120,
        workHours: 60,
      },
      child: {
        closedAt: "2024-01-05T10:00:00.000Z",
        resolutionHours: 96,
        workHours: 36,
      },
    };

    await upsertIssue(
      createDurationIssue(
        primaryRepo,
        "parent",
        issueNumber++,
        primarySpecs.parent,
      ),
    );
    await upsertIssue(
      createDurationIssue(
        primaryRepo,
        "child",
        issueNumber++,
        primarySpecs.child,
      ),
    );

    const secondarySpecs: PeriodDurations = {
      parent: {
        closedAt: "2023-12-30T12:00:00.000Z",
        resolutionHours: 200,
        workHours: 120,
      },
      child: {
        closedAt: "2024-01-03T12:00:00.000Z",
        resolutionHours: 150,
        workHours: 90,
      },
    };

    await upsertIssue(
      createDurationIssue(
        secondaryRepo,
        "parent",
        issueNumber++,
        secondarySpecs.parent,
      ),
    );
    await upsertIssue(
      createDurationIssue(
        secondaryRepo,
        "child",
        issueNumber++,
        secondarySpecs.child,
      ),
    );

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      repositoryIds: [primaryRepo.id],
    });

    const resolutionMetric = analytics.organization.metrics.issueResolutionTime;
    const workMetric = analytics.organization.metrics.issueWorkTime;

    const primaryBusiness: BusinessPeriodDurations = {
      parent: convertToBusinessDurations(primarySpecs.parent),
      child: convertToBusinessDurations(primarySpecs.child),
    };

    const expectedResolution = calculateAverage([
      primaryBusiness.parent.resolutionHours,
      primaryBusiness.child.resolutionHours,
    ]);
    const expectedWork = calculateAverage([
      primaryBusiness.parent.workHours,
      primaryBusiness.child.workHours,
    ]);

    expect(resolutionMetric.current).toBeCloseTo(expectedResolution, 5);
    expect(workMetric.current).toBeCloseTo(expectedWork, 5);

    const history = analytics.organization.metricHistory;
    const resolutionMap = Object.fromEntries(
      history.issueResolutionTime.map((entry) => [entry.period, entry.value]),
    );
    const workMap = Object.fromEntries(
      history.issueWorkTime.map((entry) => [entry.period, entry.value]),
    );

    expect(resolutionMap.current ?? Number.NaN).toBeCloseTo(
      expectedResolution,
      5,
    );
    expect(workMap.current ?? Number.NaN).toBeCloseTo(expectedWork, 5);
  });
});

function convertToBusinessDurations(spec: DurationSpec): BusinessDuration {
  const resolutionStart = shiftHours(spec.closedAt, -spec.resolutionHours);
  const workStart = shiftHours(spec.closedAt, -spec.workHours);
  const resolutionHours =
    calculateBusinessHoursBetween(
      resolutionStart,
      spec.closedAt,
      EMPTY_HOLIDAY_SET,
    ) ?? Number.NaN;
  const workHours =
    calculateBusinessHoursBetween(
      workStart,
      spec.closedAt,
      EMPTY_HOLIDAY_SET,
    ) ?? Number.NaN;
  return {
    resolutionHours,
    workHours,
  };
}
