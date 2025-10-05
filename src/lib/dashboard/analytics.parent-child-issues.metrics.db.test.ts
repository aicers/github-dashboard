// @vitest-environment jsdom
// Vitest defaults DB config to Node environment; keep this so React Testing Library has a DOM.

import "../../../tests/helpers/postgres-container";
import "@testing-library/jest-dom";

import { render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import {
  formatChange,
  formatMetricValue,
} from "@/components/dashboard/metric-utils";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";

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

const CURRENT_RANGE_START = "2024-01-01T00:00:00.000Z";
const CURRENT_RANGE_END = "2024-01-07T23:59:59.999Z";
const TARGET_PROJECT = "To-Do List";
const PERIODS = [
  "previous4",
  "previous3",
  "previous2",
  "previous",
  "current",
] as const;
type PeriodKey = (typeof PERIODS)[number];
type RoleKey = "parent" | "child";

type DurationSpec = {
  closedAt: string;
  resolutionHours: number;
  workHours: number;
};

type PeriodDurations = Record<RoleKey, DurationSpec[]>;

function shiftHours(iso: string, hours: number): string {
  const time = new Date(iso).getTime();
  const adjusted = time + hours * 3_600_000;
  return new Date(adjusted).toISOString();
}

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

function createFallbackChildIssue(
  repository: DbRepository,
  sequence: number,
  spec: DurationSpec,
): DbIssue {
  const { closedAt, resolutionHours } = spec;
  const createdAt = shiftHours(closedAt, -resolutionHours);

  return {
    id: `${repository.id}-fallback-child-${sequence}`,
    number: sequence,
    repositoryId: repository.id,
    authorId: null,
    title: `fallback child issue ${sequence}`,
    state: "CLOSED",
    createdAt,
    updatedAt: closedAt,
    closedAt,
    raw: null,
  };
}

function calculateAverage(values: number[]): number {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return Number.NaN;
  }
  const total = finiteValues.reduce((acc, value) => acc + value, 0);
  return total / finiteValues.length;
}

function seriesFromSpecs(
  specs: Record<PeriodKey, PeriodDurations>,
  role: RoleKey,
  key: "resolutionHours" | "workHours",
): number[] {
  return PERIODS.map((period) =>
    calculateAverage(specs[period]?.[role]?.map((entry) => entry[key]) ?? []),
  );
}

describe("analytics parent/child issue metrics", () => {
  beforeEach(async () => {
    await query(
      "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users RESTART IDENTITY CASCADE",
    );
  });

  it("builds parent and child duration metrics with historical breakdown", async () => {
    const actor: DbActor = {
      id: "parent-child-actor",
      login: "parent-child-user",
      name: "Parent Child",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "parent-child-repo",
      name: "parent-child-repo",
      nameWithOwner: "octo/parent-child-repo",
      ownerId: actor.id,
      raw: { id: "parent-child-repo" },
    };
    await upsertRepository(repository);

    const specs: Record<PeriodKey, PeriodDurations> = {
      previous4: {
        parent: [
          {
            closedAt: "2023-12-08T15:00:00.000Z",
            resolutionHours: 150,
            workHours: 84,
          },
          {
            closedAt: "2023-12-09T08:00:00.000Z",
            resolutionHours: 138,
            workHours: 72,
          },
        ],
        child: [
          {
            closedAt: "2023-12-09T11:00:00.000Z",
            resolutionHours: 120,
            workHours: 60,
          },
          {
            closedAt: "2023-12-10T06:00:00.000Z",
            resolutionHours: 112,
            workHours: 56,
          },
        ],
      },
      previous3: {
        parent: [
          {
            closedAt: "2023-12-15T12:00:00.000Z",
            resolutionHours: 132,
            workHours: 72,
          },
          {
            closedAt: "2023-12-16T09:00:00.000Z",
            resolutionHours: 126,
            workHours: 66,
          },
        ],
        child: [
          {
            closedAt: "2023-12-14T18:00:00.000Z",
            resolutionHours: 108,
            workHours: 54,
          },
          {
            closedAt: "2023-12-15T21:00:00.000Z",
            resolutionHours: 100,
            workHours: 50,
          },
        ],
      },
      previous2: {
        parent: [
          {
            closedAt: "2023-12-22T09:00:00.000Z",
            resolutionHours: 120,
            workHours: 66,
          },
          {
            closedAt: "2023-12-23T15:00:00.000Z",
            resolutionHours: 114,
            workHours: 60,
          },
        ],
        child: [
          {
            closedAt: "2023-12-20T17:00:00.000Z",
            resolutionHours: 96,
            workHours: 48,
          },
          {
            closedAt: "2023-12-21T20:00:00.000Z",
            resolutionHours: 88,
            workHours: 44,
          },
        ],
      },
      previous: {
        parent: [
          {
            closedAt: "2023-12-29T14:00:00.000Z",
            resolutionHours: 108,
            workHours: 60,
          },
          {
            closedAt: "2023-12-30T11:00:00.000Z",
            resolutionHours: 102,
            workHours: 54,
          },
        ],
        child: [
          {
            closedAt: "2023-12-30T10:00:00.000Z",
            resolutionHours: 84,
            workHours: 42,
          },
          {
            closedAt: "2023-12-31T13:00:00.000Z",
            resolutionHours: 76,
            workHours: 38,
          },
        ],
      },
      current: {
        parent: [
          {
            closedAt: "2024-01-05T13:00:00.000Z",
            resolutionHours: 96,
            workHours: 48,
          },
          {
            closedAt: "2024-01-06T07:00:00.000Z",
            resolutionHours: 90,
            workHours: 42,
          },
        ],
        child: [
          {
            closedAt: "2024-01-04T18:00:00.000Z",
            resolutionHours: 72,
            workHours: 36,
          },
          {
            closedAt: "2024-01-05T16:00:00.000Z",
            resolutionHours: 64,
            workHours: 32,
          },
        ],
      },
    };

    let issueNumber = 1;
    for (const period of PERIODS) {
      for (const role of ["parent", "child"] as const) {
        for (const spec of specs[period][role]) {
          await upsertIssue(
            createDurationIssue(repository, role, issueNumber++, spec),
          );
        }
      }
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const metrics = analytics.organization.metrics;
    const history = analytics.organization.metricHistory;

    const expectedParentResolutionHistory = seriesFromSpecs(
      specs,
      "parent",
      "resolutionHours",
    );
    const expectedParentWorkHistory = seriesFromSpecs(
      specs,
      "parent",
      "workHours",
    );
    const expectedChildResolutionHistory = seriesFromSpecs(
      specs,
      "child",
      "resolutionHours",
    );
    const expectedChildWorkHistory = seriesFromSpecs(
      specs,
      "child",
      "workHours",
    );

    const expectedParentResolutionCurrent =
      expectedParentResolutionHistory.at(-1) ?? Number.NaN;
    const expectedParentResolutionPrevious =
      expectedParentResolutionHistory.at(-2) ?? Number.NaN;
    const expectedParentWorkCurrent =
      expectedParentWorkHistory.at(-1) ?? Number.NaN;
    const expectedParentWorkPrevious =
      expectedParentWorkHistory.at(-2) ?? Number.NaN;
    const expectedChildResolutionCurrent =
      expectedChildResolutionHistory.at(-1) ?? Number.NaN;
    const expectedChildResolutionPrevious =
      expectedChildResolutionHistory.at(-2) ?? Number.NaN;
    const expectedChildWorkCurrent =
      expectedChildWorkHistory.at(-1) ?? Number.NaN;
    const expectedChildWorkPrevious =
      expectedChildWorkHistory.at(-2) ?? Number.NaN;

    expect(metrics.parentIssueResolutionTime.current).toBeCloseTo(
      expectedParentResolutionCurrent,
      5,
    );
    expect(metrics.parentIssueResolutionTime.previous).toBeCloseTo(
      expectedParentResolutionPrevious,
      5,
    );
    expect(metrics.parentIssueResolutionTime.absoluteChange).toBeCloseTo(
      expectedParentResolutionCurrent - expectedParentResolutionPrevious,
      5,
    );
    expect(
      metrics.parentIssueResolutionTime.percentChange ?? Number.NaN,
    ).toBeCloseTo(
      ((expectedParentResolutionCurrent - expectedParentResolutionPrevious) /
        expectedParentResolutionPrevious) *
        100,
      5,
    );
    expect(metrics.parentIssueResolutionTime.unit).toBe("hours");

    expect(metrics.parentIssueWorkTime.current).toBeCloseTo(
      expectedParentWorkCurrent,
      5,
    );
    expect(metrics.parentIssueWorkTime.previous).toBeCloseTo(
      expectedParentWorkPrevious,
      5,
    );
    expect(metrics.parentIssueWorkTime.absoluteChange).toBeCloseTo(
      expectedParentWorkCurrent - expectedParentWorkPrevious,
      5,
    );
    expect(metrics.parentIssueWorkTime.percentChange ?? Number.NaN).toBeCloseTo(
      ((expectedParentWorkCurrent - expectedParentWorkPrevious) /
        expectedParentWorkPrevious) *
        100,
      5,
    );
    expect(metrics.parentIssueWorkTime.unit).toBe("hours");

    expect(metrics.childIssueResolutionTime.current).toBeCloseTo(
      expectedChildResolutionCurrent,
      5,
    );
    expect(metrics.childIssueResolutionTime.previous).toBeCloseTo(
      expectedChildResolutionPrevious,
      5,
    );
    expect(metrics.childIssueResolutionTime.absoluteChange).toBeCloseTo(
      expectedChildResolutionCurrent - expectedChildResolutionPrevious,
      5,
    );
    expect(
      metrics.childIssueResolutionTime.percentChange ?? Number.NaN,
    ).toBeCloseTo(
      ((expectedChildResolutionCurrent - expectedChildResolutionPrevious) /
        expectedChildResolutionPrevious) *
        100,
      5,
    );
    expect(metrics.childIssueResolutionTime.unit).toBe("hours");

    expect(metrics.childIssueWorkTime.current).toBeCloseTo(
      expectedChildWorkCurrent,
      5,
    );
    expect(metrics.childIssueWorkTime.previous).toBeCloseTo(
      expectedChildWorkPrevious,
      5,
    );
    expect(metrics.childIssueWorkTime.absoluteChange).toBeCloseTo(
      expectedChildWorkCurrent - expectedChildWorkPrevious,
      5,
    );
    expect(metrics.childIssueWorkTime.percentChange ?? Number.NaN).toBeCloseTo(
      ((expectedChildWorkCurrent - expectedChildWorkPrevious) /
        expectedChildWorkPrevious) *
        100,
      5,
    );
    expect(metrics.childIssueWorkTime.unit).toBe("hours");

    const historyChecks: Array<{
      actual: { period: string; value: number | null }[];
      expectedValues: number[];
    }> = [
      {
        actual: history.parentIssueResolutionTime,
        expectedValues: expectedParentResolutionHistory,
      },
      {
        actual: history.parentIssueWorkTime,
        expectedValues: expectedParentWorkHistory,
      },
      {
        actual: history.childIssueResolutionTime,
        expectedValues: expectedChildResolutionHistory,
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
        const expectedValue = expectedValues[index];
        if (Number.isNaN(expectedValue)) {
          expect(entry.value).toBeNull();
        } else {
          expect(entry.value ?? Number.NaN).toBeCloseTo(expectedValue, 5);
        }
      });
    }

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "Parent 이슈 해결 시간",
          metric: metrics.parentIssueResolutionTime,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.parentIssueResolutionTime),
        }),
        createElement(MetricCard, {
          title: "Parent 이슈 작업 시간",
          metric: metrics.parentIssueWorkTime,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.parentIssueWorkTime),
        }),
        createElement(MetricCard, {
          title: "Child 이슈 해결 시간",
          metric: metrics.childIssueResolutionTime,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.childIssueResolutionTime),
        }),
        createElement(MetricCard, {
          title: "Child 이슈 작업 시간",
          metric: metrics.childIssueWorkTime,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.childIssueWorkTime),
        }),
      ),
    );

    const parentResolutionCard = screen
      .getByText("Parent 이슈 해결 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const parentWorkCard = screen
      .getByText("Parent 이슈 작업 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const childResolutionCard = screen
      .getByText("Child 이슈 해결 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const childWorkCard = screen
      .getByText("Child 이슈 작업 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;

    expect(parentResolutionCard).not.toBeNull();
    expect(parentWorkCard).not.toBeNull();
    expect(childResolutionCard).not.toBeNull();
    expect(childWorkCard).not.toBeNull();
    if (
      !parentResolutionCard ||
      !parentWorkCard ||
      !childResolutionCard ||
      !childWorkCard
    ) {
      throw new Error("parent/child metric cards not rendered");
    }

    const parentResolutionValue = formatMetricValue(
      {
        current: metrics.parentIssueResolutionTime.current,
        unit: metrics.parentIssueResolutionTime.unit,
      },
      "hours",
    );
    const parentResolutionChange = formatChange(
      metrics.parentIssueResolutionTime,
      "hours",
    );
    expect(
      within(parentResolutionCard).getByText(parentResolutionValue),
    ).toBeInTheDocument();
    expect(
      within(parentResolutionCard).getByText(
        `${parentResolutionChange.changeLabel} (${parentResolutionChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const parentWorkValue = formatMetricValue(
      {
        current: metrics.parentIssueWorkTime.current,
        unit: metrics.parentIssueWorkTime.unit,
      },
      "hours",
    );
    const parentWorkChange = formatChange(metrics.parentIssueWorkTime, "hours");
    expect(
      within(parentWorkCard).getByText(parentWorkValue),
    ).toBeInTheDocument();
    expect(
      within(parentWorkCard).getByText(
        `${parentWorkChange.changeLabel} (${parentWorkChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const childResolutionValue = formatMetricValue(
      {
        current: metrics.childIssueResolutionTime.current,
        unit: metrics.childIssueResolutionTime.unit,
      },
      "hours",
    );
    const childResolutionChange = formatChange(
      metrics.childIssueResolutionTime,
      "hours",
    );
    expect(
      within(childResolutionCard).getByText(childResolutionValue),
    ).toBeInTheDocument();
    expect(
      within(childResolutionCard).getByText(
        `${childResolutionChange.changeLabel} (${childResolutionChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const childWorkValue = formatMetricValue(
      {
        current: metrics.childIssueWorkTime.current,
        unit: metrics.childIssueWorkTime.unit,
      },
      "hours",
    );
    const childWorkChange = formatChange(metrics.childIssueWorkTime, "hours");
    expect(within(childWorkCard).getByText(childWorkValue)).toBeInTheDocument();
    expect(
      within(childWorkCard).getByText(
        `${childWorkChange.changeLabel} (${childWorkChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });

  it("treats missing parent links as child-only metrics and reports empty parents", async () => {
    const actor: DbActor = {
      id: "parent-child-edge-actor",
      login: "parent-child-edge-user",
      name: "Parent Child Edge",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "parent-child-edge-repo",
      name: "parent-child-edge-repo",
      nameWithOwner: "octo/parent-child-edge-repo",
      ownerId: actor.id,
      raw: { id: "parent-child-edge-repo" },
    };
    await upsertRepository(repository);

    let issueNumber = 1;

    const previousChildSpec: DurationSpec = {
      closedAt: "2023-12-30T10:00:00.000Z",
      resolutionHours: 48,
      workHours: 24,
    };
    await upsertIssue(
      createDurationIssue(
        repository,
        "child",
        issueNumber++,
        previousChildSpec,
      ),
    );

    const currentChildSpecs: DurationSpec[] = [
      {
        closedAt: "2024-01-05T12:00:00.000Z",
        resolutionHours: 72,
        workHours: 36,
      },
      {
        closedAt: "2024-01-06T09:00:00.000Z",
        resolutionHours: 24,
        workHours: 0,
      },
    ];

    await upsertIssue(
      createDurationIssue(
        repository,
        "child",
        issueNumber++,
        currentChildSpecs[0],
      ),
    );
    await upsertIssue(
      createFallbackChildIssue(repository, issueNumber++, currentChildSpecs[1]),
    );

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const parentResolutionMetric =
      analytics.organization.metrics.parentIssueResolutionTime;
    const parentWorkMetric = analytics.organization.metrics.parentIssueWorkTime;
    const childResolutionMetric =
      analytics.organization.metrics.childIssueResolutionTime;
    const childWorkMetric = analytics.organization.metrics.childIssueWorkTime;
    const history = analytics.organization.metricHistory;

    expect(Number.isNaN(parentResolutionMetric.current)).toBe(true);
    expect(Number.isNaN(parentResolutionMetric.previous)).toBe(true);
    expect(Number.isNaN(parentResolutionMetric.absoluteChange)).toBe(true);
    expect(parentResolutionMetric.percentChange).toBeNull();

    expect(Number.isNaN(parentWorkMetric.current)).toBe(true);
    expect(Number.isNaN(parentWorkMetric.previous)).toBe(true);
    expect(Number.isNaN(parentWorkMetric.absoluteChange)).toBe(true);
    expect(parentWorkMetric.percentChange).toBeNull();

    const expectedChildResolutionCurrent = calculateAverage(
      currentChildSpecs.map((spec) => spec.resolutionHours),
    );
    const expectedChildResolutionPrevious = previousChildSpec.resolutionHours;
    expect(childResolutionMetric.current).toBeCloseTo(
      expectedChildResolutionCurrent,
      5,
    );
    expect(childResolutionMetric.previous).toBeCloseTo(
      expectedChildResolutionPrevious,
      5,
    );
    expect(childResolutionMetric.absoluteChange).toBeCloseTo(0, 5);
    expect(childResolutionMetric.percentChange).toBe(0);

    const expectedChildWorkCurrent = calculateAverage([
      currentChildSpecs[0].workHours,
    ]);
    const expectedChildWorkPrevious = previousChildSpec.workHours;
    expect(childWorkMetric.current).toBeCloseTo(expectedChildWorkCurrent, 5);
    expect(childWorkMetric.previous).toBeCloseTo(expectedChildWorkPrevious, 5);
    expect(childWorkMetric.absoluteChange).toBeCloseTo(
      expectedChildWorkCurrent - expectedChildWorkPrevious,
      5,
    );
    expect(childWorkMetric.percentChange ?? Number.NaN).toBeCloseTo(50, 5);

    history.parentIssueResolutionTime.forEach((entry) => {
      expect(entry.value).toBeNull();
    });
    history.parentIssueWorkTime.forEach((entry) => {
      expect(entry.value).toBeNull();
    });

    const childResolutionHistory = history.childIssueResolutionTime;
    expect(childResolutionHistory.at(-1)?.value ?? Number.NaN).toBeCloseTo(
      expectedChildResolutionCurrent,
      5,
    );
    expect(childResolutionHistory.at(-2)?.value ?? Number.NaN).toBeCloseTo(
      expectedChildResolutionPrevious,
      5,
    );

    const childWorkHistory = history.childIssueWorkTime;
    expect(childWorkHistory.at(-1)?.value ?? Number.NaN).toBeCloseTo(
      expectedChildWorkCurrent,
      5,
    );
    expect(childWorkHistory.at(-2)?.value ?? Number.NaN).toBeCloseTo(
      expectedChildWorkPrevious,
      5,
    );

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "Parent 이슈 해결 시간",
          metric: parentResolutionMetric,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.parentIssueResolutionTime),
        }),
        createElement(MetricCard, {
          title: "Child 이슈 해결 시간",
          metric: childResolutionMetric,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.childIssueResolutionTime),
        }),
        createElement(MetricCard, {
          title: "Parent 이슈 작업 시간",
          metric: parentWorkMetric,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.parentIssueWorkTime),
        }),
        createElement(MetricCard, {
          title: "Child 이슈 작업 시간",
          metric: childWorkMetric,
          format: "hours",
          impact: "negative",
          history: toCardHistory(history.childIssueWorkTime),
        }),
      ),
    );

    const parentResolutionCard = screen
      .getByText("Parent 이슈 해결 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const parentWorkCard = screen
      .getByText("Parent 이슈 작업 시간")
      .closest('[data-slot="card"]') as HTMLElement | null;

    expect(parentResolutionCard).not.toBeNull();
    expect(parentWorkCard).not.toBeNull();
    if (!parentResolutionCard || !parentWorkCard) {
      throw new Error("parent fallback cards not rendered");
    }

    const parentResolutionChange = formatChange(
      parentResolutionMetric,
      "hours",
    );
    const parentWorkChange = formatChange(parentWorkMetric, "hours");
    expect(
      within(parentResolutionCard).getByText(
        `${parentResolutionChange.changeLabel} (${parentResolutionChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
    expect(
      within(parentWorkCard).getByText(
        `${parentWorkChange.changeLabel} (${parentWorkChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
    expect(
      within(parentResolutionCard).getByText(
        formatMetricValue(
          {
            current: parentResolutionMetric.current,
            unit: parentResolutionMetric.unit,
          },
          "hours",
        ),
      ),
    ).toBeInTheDocument();
    expect(
      within(parentWorkCard).getByText(
        formatMetricValue(
          { current: parentWorkMetric.current, unit: parentWorkMetric.unit },
          "hours",
        ),
      ),
    ).toBeInTheDocument();
  });

  it("honors repository filters when aggregating parent and child metrics", async () => {
    const actor: DbActor = {
      id: "parent-child-filter-actor",
      login: "parent-child-filter-user",
      name: "Parent Child Filter",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const primaryRepo: DbRepository = {
      id: "parent-child-filter-primary",
      name: "parent-child-filter-primary",
      nameWithOwner: "octo/parent-child-filter-primary",
      ownerId: actor.id,
      raw: { id: "parent-child-filter-primary" },
    };
    await upsertRepository(primaryRepo);

    const secondaryRepo: DbRepository = {
      id: "parent-child-filter-secondary",
      name: "parent-child-filter-secondary",
      nameWithOwner: "octo/parent-child-filter-secondary",
      ownerId: actor.id,
      raw: { id: "parent-child-filter-secondary" },
    };
    await upsertRepository(secondaryRepo);

    let issueNumber = 1;

    const primaryPrevious: PeriodDurations = {
      parent: [
        {
          closedAt: "2023-12-30T12:00:00.000Z",
          resolutionHours: 120,
          workHours: 60,
        },
      ],
      child: [
        {
          closedAt: "2023-12-29T09:00:00.000Z",
          resolutionHours: 96,
          workHours: 48,
        },
      ],
    };

    const primaryCurrent: PeriodDurations = {
      parent: [
        {
          closedAt: "2024-01-05T12:00:00.000Z",
          resolutionHours: 90,
          workHours: 45,
        },
        {
          closedAt: "2024-01-06T09:00:00.000Z",
          resolutionHours: 84,
          workHours: 42,
        },
      ],
      child: [
        {
          closedAt: "2024-01-04T18:00:00.000Z",
          resolutionHours: 72,
          workHours: 36,
        },
        {
          closedAt: "2024-01-05T16:00:00.000Z",
          resolutionHours: 60,
          workHours: 30,
        },
      ],
    };

    const secondaryCurrent: PeriodDurations = {
      parent: [
        {
          closedAt: "2024-01-03T12:00:00.000Z",
          resolutionHours: 200,
          workHours: 120,
        },
      ],
      child: [
        {
          closedAt: "2024-01-02T15:00:00.000Z",
          resolutionHours: 150,
          workHours: 90,
        },
      ],
    };

    for (const spec of primaryPrevious.parent) {
      await upsertIssue(
        createDurationIssue(primaryRepo, "parent", issueNumber++, spec),
      );
    }
    for (const spec of primaryPrevious.child) {
      await upsertIssue(
        createDurationIssue(primaryRepo, "child", issueNumber++, spec),
      );
    }
    for (const spec of primaryCurrent.parent) {
      await upsertIssue(
        createDurationIssue(primaryRepo, "parent", issueNumber++, spec),
      );
    }
    for (const spec of primaryCurrent.child) {
      await upsertIssue(
        createDurationIssue(primaryRepo, "child", issueNumber++, spec),
      );
    }

    for (const spec of secondaryCurrent.parent) {
      await upsertIssue(
        createDurationIssue(secondaryRepo, "parent", issueNumber++, spec),
      );
    }
    for (const spec of secondaryCurrent.child) {
      await upsertIssue(
        createDurationIssue(secondaryRepo, "child", issueNumber++, spec),
      );
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      repositoryIds: [primaryRepo.id],
    });

    const metrics = analytics.organization.metrics;
    const history = analytics.organization.metricHistory;

    const expectedParentResolutionCurrent = calculateAverage(
      primaryCurrent.parent.map((spec) => spec.resolutionHours),
    );
    const expectedParentResolutionPrevious = calculateAverage(
      primaryPrevious.parent.map((spec) => spec.resolutionHours),
    );
    const expectedParentWorkCurrent = calculateAverage(
      primaryCurrent.parent.map((spec) => spec.workHours),
    );
    const expectedParentWorkPrevious = calculateAverage(
      primaryPrevious.parent.map((spec) => spec.workHours),
    );
    const expectedChildResolutionCurrent = calculateAverage(
      primaryCurrent.child.map((spec) => spec.resolutionHours),
    );
    const expectedChildResolutionPrevious = calculateAverage(
      primaryPrevious.child.map((spec) => spec.resolutionHours),
    );
    const expectedChildWorkCurrent = calculateAverage(
      primaryCurrent.child.map((spec) => spec.workHours),
    );
    const expectedChildWorkPrevious = calculateAverage(
      primaryPrevious.child.map((spec) => spec.workHours),
    );

    expect(metrics.parentIssueResolutionTime.current).toBeCloseTo(
      expectedParentResolutionCurrent,
      5,
    );
    expect(metrics.parentIssueResolutionTime.previous).toBeCloseTo(
      expectedParentResolutionPrevious,
      5,
    );
    expect(metrics.parentIssueWorkTime.current).toBeCloseTo(
      expectedParentWorkCurrent,
      5,
    );
    expect(metrics.parentIssueWorkTime.previous).toBeCloseTo(
      expectedParentWorkPrevious,
      5,
    );

    expect(metrics.childIssueResolutionTime.current).toBeCloseTo(
      expectedChildResolutionCurrent,
      5,
    );
    expect(metrics.childIssueResolutionTime.previous).toBeCloseTo(
      expectedChildResolutionPrevious,
      5,
    );
    expect(metrics.childIssueWorkTime.current).toBeCloseTo(
      expectedChildWorkCurrent,
      5,
    );
    expect(metrics.childIssueWorkTime.previous).toBeCloseTo(
      expectedChildWorkPrevious,
      5,
    );

    const parentResolutionMap = Object.fromEntries(
      history.parentIssueResolutionTime.map((entry) => [
        entry.period,
        entry.value,
      ]),
    );
    const parentWorkMap = Object.fromEntries(
      history.parentIssueWorkTime.map((entry) => [entry.period, entry.value]),
    );
    const childResolutionMap = Object.fromEntries(
      history.childIssueResolutionTime.map((entry) => [
        entry.period,
        entry.value,
      ]),
    );
    const childWorkMap = Object.fromEntries(
      history.childIssueWorkTime.map((entry) => [entry.period, entry.value]),
    );

    expect(parentResolutionMap.current ?? Number.NaN).toBeCloseTo(
      expectedParentResolutionCurrent,
      5,
    );
    expect(parentResolutionMap.previous ?? Number.NaN).toBeCloseTo(
      expectedParentResolutionPrevious,
      5,
    );
    expect(parentWorkMap.current ?? Number.NaN).toBeCloseTo(
      expectedParentWorkCurrent,
      5,
    );
    expect(parentWorkMap.previous ?? Number.NaN).toBeCloseTo(
      expectedParentWorkPrevious,
      5,
    );

    expect(childResolutionMap.current ?? Number.NaN).toBeCloseTo(
      expectedChildResolutionCurrent,
      5,
    );
    expect(childResolutionMap.previous ?? Number.NaN).toBeCloseTo(
      expectedChildResolutionPrevious,
      5,
    );
    expect(childWorkMap.current ?? Number.NaN).toBeCloseTo(
      expectedChildWorkCurrent,
      5,
    );
    expect(childWorkMap.previous ?? Number.NaN).toBeCloseTo(
      expectedChildWorkPrevious,
      5,
    );
  });
});
