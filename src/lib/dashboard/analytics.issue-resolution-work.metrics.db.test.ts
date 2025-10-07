// @vitest-environment jsdom
// Vitest defaults DB config to Node environment; keep this so React Testing Library has a DOM.

import "../../../tests/helpers/postgres-container";
import "@testing-library/jest-dom";

import { render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  type PeriodKey,
  resetDashboardTables,
  shiftHours,
} from "../../../tests/helpers/dashboard-metrics";
import {
  formatChangeForTest,
  formatMetricValueForTest,
} from "../../../tests/helpers/metric-formatting";

vi.mock("recharts", () => {
  const { createElement: createReactElement } =
    require("react") as typeof import("react");

  const createStub =
    (testId: string) =>
    ({ children }: { children?: import("react").ReactNode }) =>
      createReactElement("div", { "data-testid": testId }, children ?? null);

  return {
    ResponsiveContainer: createStub("recharts-responsive"),
    LineChart: createStub("recharts-line-chart"),
    Line: createStub("recharts-line"),
    XAxis: createStub("recharts-x-axis"),
    YAxis: createStub("recharts-y-axis"),
  };
});

const TARGET_PROJECT = "To-Do List";
const PERIODS = PERIOD_KEYS;
type RoleKey = "parent" | "child";

type DurationSpec = {
  closedAt: string;
  resolutionHours: number;
  workHours: number;
};

type PeriodDurations = Record<RoleKey, DurationSpec>;

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
  beforeEach(async () => {
    await resetDashboardTables();
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
      const { parent, child } = specs[period];
      return calculateAverage([parent.resolutionHours, child.resolutionHours]);
    });
    const expectedWorkHistory = PERIODS.map((period) => {
      const { parent, child } = specs[period];
      return calculateAverage([parent.workHours, child.workHours]);
    });
    const expectedParentResolutionHistory = PERIODS.map(
      (period) => specs[period].parent.resolutionHours,
    );
    const expectedChildResolutionHistory = PERIODS.map(
      (period) => specs[period].child.resolutionHours,
    );
    const expectedParentWorkHistory = PERIODS.map(
      (period) => specs[period].parent.workHours,
    );
    const expectedChildWorkHistory = PERIODS.map(
      (period) => specs[period].child.workHours,
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
      specs.current.parent.resolutionHours,
      5,
    );
    expect(metrics.childIssueResolutionTime.current).toBeCloseTo(
      specs.current.child.resolutionHours,
      5,
    );
    expect(metrics.parentIssueWorkTime.current).toBeCloseTo(
      specs.current.parent.workHours,
      5,
    );
    expect(metrics.childIssueWorkTime.current).toBeCloseTo(
      specs.current.child.workHours,
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

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "평균 해결 시간",
          metric: metrics.issueResolutionTime,
          format: "hours",
          history: toCardHistory(history.issueResolutionTime),
        }),
        createElement(MetricCard, {
          title: "평균 작업 시간",
          metric: metrics.issueWorkTime,
          format: "hours",
          history: toCardHistory(history.issueWorkTime),
        }),
      ),
    );

    const resolutionCard = screen
      .getByText("평균 해결 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const workCard = screen
      .getByText("평균 작업 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;

    const resolutionCardElement = resolutionCard;
    const workCardElement = workCard;
    expect(resolutionCardElement).not.toBeNull();
    expect(workCardElement).not.toBeNull();
    if (!resolutionCardElement || !workCardElement) {
      throw new Error("metric card elements not found");
    }

    const resolutionMetric = metrics.issueResolutionTime;
    const resolutionValueLabel = formatMetricValueForTest(
      { current: resolutionMetric.current, unit: resolutionMetric.unit },
      "hours",
    );
    const resolutionChange = formatChangeForTest(
      resolutionMetric,
      "hours",
      resolutionMetric.unit ?? "hours",
    );

    expect(
      within(resolutionCardElement).getByText(resolutionValueLabel),
    ).toBeInTheDocument();
    expect(
      within(resolutionCardElement).getByText(
        `${resolutionChange.changeLabel} (${resolutionChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const workMetric = metrics.issueWorkTime;
    const workValueLabel = formatMetricValueForTest(
      { current: workMetric.current, unit: workMetric.unit },
      "hours",
    );
    const workChange = formatChangeForTest(
      workMetric,
      "hours",
      workMetric.unit ?? "hours",
    );

    expect(
      within(workCardElement).getByText(workValueLabel),
    ).toBeInTheDocument();
    expect(
      within(workCardElement).getByText(
        `${workChange.changeLabel} (${workChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
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

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "평균 해결 시간",
          metric: resolutionMetric,
          format: "hours",
          history: toCardHistory(
            analytics.organization.metricHistory.issueResolutionTime,
          ),
        }),
        createElement(MetricCard, {
          title: "평균 작업 시간",
          metric: workMetric,
          format: "hours",
          history: toCardHistory(
            analytics.organization.metricHistory.issueWorkTime,
          ),
        }),
      ),
    );

    const resolutionCard = screen
      .getByText("평균 해결 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const workCard = screen
      .getByText("평균 작업 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;

    expect(resolutionCard).not.toBeNull();
    expect(workCard).not.toBeNull();
    if (!resolutionCard || !workCard) {
      throw new Error("zero baseline cards not found");
    }

    const resolutionLabel = formatMetricValueForTest(
      { current: resolutionMetric.current, unit: resolutionMetric.unit },
      "hours",
    );
    const resolutionChange = formatChangeForTest(
      resolutionMetric,
      "hours",
      resolutionMetric.unit ?? "hours",
    );
    expect(
      within(resolutionCard).getByText(resolutionLabel),
    ).toBeInTheDocument();
    expect(
      within(resolutionCard).getByText(
        `${resolutionChange.changeLabel} (${resolutionChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const workLabel = formatMetricValueForTest(
      { current: workMetric.current, unit: workMetric.unit },
      "hours",
    );
    const workChange = formatChangeForTest(
      workMetric,
      "hours",
      workMetric.unit ?? "hours",
    );
    expect(within(workCard).getByText(workLabel)).toBeInTheDocument();
    expect(
      within(workCard).getByText(
        `${workChange.changeLabel} (${workChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
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

    const expectedResolution = calculateAverage([
      primarySpecs.parent.resolutionHours,
      primarySpecs.child.resolutionHours,
    ]);
    const expectedWork = calculateAverage([
      primarySpecs.parent.workHours,
      primarySpecs.child.workHours,
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

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "평균 해결 시간",
          metric: resolutionMetric,
          format: "hours",
          history: toCardHistory(history.issueResolutionTime),
        }),
        createElement(MetricCard, {
          title: "평균 작업 시간",
          metric: workMetric,
          format: "hours",
          history: toCardHistory(history.issueWorkTime),
        }),
      ),
    );

    const resolutionCard = screen
      .getByText("평균 해결 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const workCard = screen
      .getByText("평균 작업 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;

    expect(resolutionCard).not.toBeNull();
    expect(workCard).not.toBeNull();
    if (!resolutionCard || !workCard) {
      throw new Error("filtered cards not found");
    }

    const resolutionValue = formatMetricValueForTest(
      { current: resolutionMetric.current, unit: resolutionMetric.unit },
      "hours",
    );
    const resolutionChange = formatChangeForTest(
      resolutionMetric,
      "hours",
      resolutionMetric.unit ?? "hours",
    );
    expect(
      within(resolutionCard).getByText(resolutionValue),
    ).toBeInTheDocument();
    expect(
      within(resolutionCard).getByText(
        `${resolutionChange.changeLabel} (${resolutionChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const workValue = formatMetricValueForTest(
      { current: workMetric.current, unit: workMetric.unit },
      "hours",
    );
    const workChange = formatChangeForTest(
      workMetric,
      "hours",
      workMetric.unit ?? "hours",
    );
    expect(within(workCard).getByText(workValue)).toBeInTheDocument();
    expect(
      within(workCard).getByText(
        `${workChange.changeLabel} (${workChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });
});
