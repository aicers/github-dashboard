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
import type { ComparisonValue, PeriodKey } from "@/lib/dashboard/types";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  upsertPullRequest,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
} from "../../../tests/helpers/dashboard-metrics";
import { formatChangeForTest } from "../../../tests/helpers/metric-formatting";

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

const PERIODS = PERIOD_KEYS;

type PrSizeSpec = {
  mergedAt: string;
  additions: number;
  deletions: number;
  authorId?: string;
};

type PeriodStats = Record<
  PeriodKey,
  {
    additions: number;
    deletions: number;
    total: number;
    net: number;
  }
>;

const LINE_DECIMAL_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function hoursBefore(iso: string, hours: number) {
  const base = new Date(iso).getTime();
  return new Date(base - hours * 3_600_000).toISOString();
}

function roundToOneDecimal(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 10) / 10;
}

function buildPullRequest({
  repository,
  authorId,
  mergedAt,
  additions,
  deletions,
  id,
  number,
}: {
  repository: DbRepository;
  authorId: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  id: string;
  number: number;
}): DbPullRequest {
  const createdAt = hoursBefore(mergedAt, 12);
  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title: id,
    state: "MERGED",
    createdAt,
    updatedAt: mergedAt,
    closedAt: mergedAt,
    mergedAt,
    merged: true,
    raw: {
      additions,
      deletions,
      author: { id: authorId },
      comments: { totalCount: 0 },
    },
  };
}

function computePeriodStats(
  specs: PrSizeSpec[],
  excludedAuthorId?: string,
): { additions: number; deletions: number; total: number; net: number } {
  const relevant = specs.filter((spec) => spec.authorId !== excludedAuthorId);
  if (!relevant.length) {
    return { additions: 0, deletions: 0, total: 0, net: 0 };
  }

  const additionsTotal = relevant.reduce(
    (total, spec) => total + spec.additions,
    0,
  );
  const deletionsTotal = relevant.reduce(
    (total, spec) => total + spec.deletions,
    0,
  );
  const additionsAverage = additionsTotal / relevant.length;
  const deletionsAverage = deletionsTotal / relevant.length;

  return {
    additions: additionsAverage,
    deletions: deletionsAverage,
    total: additionsAverage + deletionsAverage,
    net: additionsAverage - deletionsAverage,
  };
}

function buildAvgPrSizeModes(metric: ComparisonValue) {
  const breakdown = metric.breakdown ?? [];
  const additionsEntry = breakdown.find((entry) => entry.label === "+ 합계");
  const deletionsEntry = breakdown.find((entry) => entry.label === "- 합계");

  const fallbackCurrent = roundToOneDecimal(metric.current ?? 0);
  const fallbackPrevious = roundToOneDecimal(metric.previous ?? 0);

  const additionsCurrent = roundToOneDecimal(
    additionsEntry?.current ?? fallbackCurrent,
  );
  const additionsPrevious = roundToOneDecimal(
    additionsEntry?.previous ?? fallbackPrevious,
  );
  const deletionsCurrent = roundToOneDecimal(deletionsEntry?.current ?? 0);
  const deletionsPrevious = roundToOneDecimal(deletionsEntry?.previous ?? 0);

  const netCurrent = roundToOneDecimal(additionsCurrent - deletionsCurrent);
  const netPrevious = roundToOneDecimal(additionsPrevious - deletionsPrevious);

  const toComparisonValue = (current: number, previous: number) => {
    const absoluteChange = roundToOneDecimal(current - previous);
    const percentChange =
      previous === 0 ? null : (current - previous) / previous;
    const value: ComparisonValue = {
      current,
      previous,
      absoluteChange,
      percentChange,
    };
    if (breakdown.length) {
      value.breakdown = breakdown;
    }
    return value;
  };

  const additionsMetric = toComparisonValue(
    additionsCurrent,
    additionsPrevious,
  );
  const netMetric = toComparisonValue(netCurrent, netPrevious);
  const additionsDisplay = LINE_DECIMAL_FORMATTER.format(additionsCurrent);
  const deletionsDisplay = LINE_DECIMAL_FORMATTER.format(deletionsCurrent);
  const valueLabel = `+${additionsDisplay} / -${deletionsDisplay} 라인`;

  return {
    additionsMetric,
    netMetric,
    valueLabel,
  };
}

describe("analytics PR average size metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("builds average size metrics with additions and net histories", async () => {
    const author: DbActor = {
      id: "pr-size-author",
      login: "octo-dev",
      name: "Octo Dev",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabot: DbActor = {
      id: "dependabot",
      login: "dependabot[bot]",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "pr-size-repo",
      name: "pr-size-repo",
      nameWithOwner: "octo/pr-size-repo",
      ownerId: author.id,
      raw: { id: "pr-size-repo" },
    };
    await upsertRepository(repository);

    const periodSpecs: Record<PeriodKey, PrSizeSpec[]> = {
      previous4: [
        {
          mergedAt: "2023-12-04T12:00:00.000Z",
          additions: 111,
          deletions: 31,
        },
        {
          mergedAt: "2023-12-07T09:30:00.000Z",
          additions: 112,
          deletions: 33,
        },
      ],
      previous3: [
        {
          mergedAt: "2023-12-11T10:15:00.000Z",
          additions: 85,
          deletions: 92,
        },
        {
          mergedAt: "2023-12-13T16:45:00.000Z",
          additions: 87,
          deletions: 94,
        },
      ],
      previous2: [
        {
          mergedAt: "2023-12-18T14:10:00.000Z",
          additions: 131,
          deletions: 43,
        },
        {
          mergedAt: "2023-12-20T18:30:00.000Z",
          additions: 134,
          deletions: 37,
        },
      ],
      previous: [
        {
          mergedAt: "2023-12-26T11:05:00.000Z",
          additions: 150,
          deletions: 52,
        },
        {
          mergedAt: "2023-12-28T19:20:00.000Z",
          additions: 152,
          deletions: 48,
        },
        {
          mergedAt: "2023-12-29T08:40:00.000Z",
          additions: 210,
          deletions: 15,
          authorId: dependabot.id,
        },
      ],
      current: [
        {
          mergedAt: "2024-01-02T09:25:00.000Z",
          additions: 172,
          deletions: 62,
        },
        {
          mergedAt: "2024-01-05T13:55:00.000Z",
          additions: 168,
          deletions: 65,
        },
        {
          mergedAt: "2024-01-04T07:15:00.000Z",
          additions: 300,
          deletions: 20,
          authorId: dependabot.id,
        },
      ],
    };

    let pullNumber = 1;
    for (const period of PERIODS) {
      const specs = periodSpecs[period];
      for (const [index, spec] of specs.entries()) {
        const pullRequest = buildPullRequest({
          repository,
          authorId: spec.authorId ?? author.id,
          mergedAt: spec.mergedAt,
          additions: spec.additions,
          deletions: spec.deletions,
          id: `${repository.id}-${period}-${index + 1}`,
          number: pullNumber++,
        });
        await upsertPullRequest(pullRequest);
      }
    }

    const outOfRange = buildPullRequest({
      repository,
      authorId: author.id,
      mergedAt: "2023-11-15T10:00:00.000Z",
      additions: 400,
      deletions: 20,
      id: `${repository.id}-out-of-range`,
      number: pullNumber++,
    });
    await upsertPullRequest(outOfRange);

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const stats: PeriodStats = PERIODS.reduce((acc, period) => {
      acc[period] = computePeriodStats(periodSpecs[period], dependabot.id);
      return acc;
    }, {} as PeriodStats);

    const organization = analytics.organization;
    const avgPrSize = organization.metrics.avgPrSize;
    const currentStats = stats.current;
    const previousStats = stats.previous;

    expect(avgPrSize.current).toBeCloseTo(
      roundToOneDecimal(currentStats.total),
      5,
    );
    expect(avgPrSize.previous).toBeCloseTo(
      roundToOneDecimal(previousStats.total),
      5,
    );
    expect(avgPrSize.absoluteChange).toBeCloseTo(
      roundToOneDecimal(currentStats.total) -
        roundToOneDecimal(previousStats.total),
      5,
    );
    const expectedPercentChange =
      previousStats.total === 0
        ? null
        : ((currentStats.total - previousStats.total) / previousStats.total) *
          100;
    expect(avgPrSize.percentChange).toBeCloseTo(expectedPercentChange ?? 0, 5);

    const breakdown = avgPrSize.breakdown ?? [];
    expect(breakdown).toHaveLength(2);
    const additionsBreakdown = breakdown.find(
      (entry) => entry.label === "+ 합계",
    );
    const deletionsBreakdown = breakdown.find(
      (entry) => entry.label === "- 합계",
    );
    expect(additionsBreakdown?.current).toBeCloseTo(
      roundToOneDecimal(currentStats.additions),
      5,
    );
    expect(additionsBreakdown?.previous).toBeCloseTo(
      roundToOneDecimal(previousStats.additions),
      5,
    );
    expect(deletionsBreakdown?.current).toBeCloseTo(
      roundToOneDecimal(currentStats.deletions),
      5,
    );
    expect(deletionsBreakdown?.previous).toBeCloseTo(
      roundToOneDecimal(previousStats.deletions),
      5,
    );

    const additionsHistory = organization.metricHistory.avgPrAdditions;
    const expectedAdditionsHistory = PERIODS.map((period) =>
      roundToOneDecimal(stats[period].additions),
    );
    additionsHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      expect(entry.value).not.toBeNull();
      expect(entry.value ?? Number.NaN).toBeCloseTo(
        expectedAdditionsHistory[index],
        5,
      );
    });

    const netHistory = organization.metricHistory.avgPrNet;
    const expectedNetHistory = PERIODS.map((period) =>
      roundToOneDecimal(stats[period].net),
    );
    netHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      expect(entry.value).not.toBeNull();
      expect(entry.value ?? Number.NaN).toBeCloseTo(
        expectedNetHistory[index],
        5,
      );
    });

    const { additionsMetric, netMetric, valueLabel } =
      buildAvgPrSizeModes(avgPrSize);

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 평균 크기 (추가)",
          metric: additionsMetric,
          format: "count",
          history: toCardHistory(additionsHistory),
          valueOverride: valueLabel,
        }),
        createElement(MetricCard, {
          title: "PR 평균 크기 (순증)",
          metric: netMetric,
          format: "count",
          history: toCardHistory(netHistory),
          valueOverride: valueLabel,
        }),
      ),
    );

    const additionsCardElement = screen
      .getByText("PR 평균 크기 (추가)")
      .closest('[data-slot="card"]');
    const netCardElement = screen
      .getByText("PR 평균 크기 (순증)")
      .closest('[data-slot="card"]');

    if (
      !(additionsCardElement instanceof HTMLElement) ||
      !(netCardElement instanceof HTMLElement)
    ) {
      throw new Error("metric cards not rendered");
    }

    expect(
      within(additionsCardElement).getByText(valueLabel),
    ).toBeInTheDocument();
    const additionsChange = formatChangeForTest(additionsMetric, "count");
    expect(
      within(additionsCardElement).getByText(
        `${additionsChange.changeLabel} (${additionsChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const netChange = formatChangeForTest(netMetric, "count");
    expect(
      within(netCardElement).getByText(
        `${netChange.changeLabel} (${netChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });

  it("handles zero previous averages for additions and net", async () => {
    const author: DbActor = {
      id: "pr-size-author-zero",
      login: "octo-zero",
      name: "Octo Zero",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabot: DbActor = {
      id: "dependabot-zero",
      login: "dependabot[bot]",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "pr-size-zero-repo",
      name: "pr-size-zero-repo",
      nameWithOwner: "octo/pr-size-zero-repo",
      ownerId: author.id,
      raw: { id: "pr-size-zero-repo" },
    };
    await upsertRepository(repository);

    const currentSpecs: PrSizeSpec[] = [
      {
        mergedAt: "2024-01-03T12:00:00.000Z",
        additions: 180,
        deletions: 40,
      },
      {
        mergedAt: "2024-01-05T09:30:00.000Z",
        additions: 150,
        deletions: 60,
      },
      {
        mergedAt: "2024-01-04T07:45:00.000Z",
        additions: 220,
        deletions: 30,
        authorId: dependabot.id,
      },
    ];

    let pullNumber = 1;
    for (const [index, spec] of currentSpecs.entries()) {
      const pullRequest = buildPullRequest({
        repository,
        authorId: spec.authorId ?? author.id,
        mergedAt: spec.mergedAt,
        additions: spec.additions,
        deletions: spec.deletions,
        id: `${repository.id}-current-${index + 1}`,
        number: pullNumber++,
      });
      await upsertPullRequest(pullRequest);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const avgPrSize = analytics.organization.metrics.avgPrSize;
    expect(avgPrSize.previous).toBe(0);
    expect(avgPrSize.absoluteChange).toBeCloseTo(avgPrSize.current, 5);
    expect(avgPrSize.percentChange).toBeNull();

    const breakdown = avgPrSize.breakdown ?? [];
    const additionsBreakdown = breakdown.find(
      (entry) => entry.label === "+ 합계",
    );
    const deletionsBreakdown = breakdown.find(
      (entry) => entry.label === "- 합계",
    );
    expect(additionsBreakdown?.previous).toBe(0);
    expect(deletionsBreakdown?.previous).toBe(0);

    const additionsHistory =
      analytics.organization.metricHistory.avgPrAdditions;
    const netHistory = analytics.organization.metricHistory.avgPrNet;
    const historyExpectations: Array<{
      history: typeof additionsHistory;
      currentExpected: number;
    }> = [
      {
        history: additionsHistory,
        currentExpected: roundToOneDecimal((180 + 150) / 2),
      },
      {
        history: netHistory,
        currentExpected: roundToOneDecimal((180 + 150) / 2 - (40 + 60) / 2),
      },
    ];

    historyExpectations.forEach(({ history, currentExpected }) => {
      expect(history).toHaveLength(PERIODS.length);
      history.forEach((entry, index) => {
        expect(entry.period).toBe(PERIODS[index]);
        if (entry.period === "current") {
          expect(entry.value ?? Number.NaN).toBeCloseTo(currentExpected, 5);
        } else {
          expect(entry.value).toBe(0);
        }
      });
    });

    const { additionsMetric, netMetric, valueLabel } =
      buildAvgPrSizeModes(avgPrSize);

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 평균 크기 (추가)",
          metric: additionsMetric,
          format: "count",
          history: toCardHistory(additionsHistory),
          valueOverride: valueLabel,
        }),
        createElement(MetricCard, {
          title: "PR 평균 크기 (순증)",
          metric: netMetric,
          format: "count",
          history: toCardHistory(netHistory),
          valueOverride: valueLabel,
        }),
      ),
    );

    const additionsCardElement = screen
      .getByText("PR 평균 크기 (추가)")
      .closest('[data-slot="card"]');
    const netCardElement = screen
      .getByText("PR 평균 크기 (순증)")
      .closest('[data-slot="card"]');

    if (
      !(additionsCardElement instanceof HTMLElement) ||
      !(netCardElement instanceof HTMLElement)
    ) {
      throw new Error("zero baseline cards not rendered");
    }

    expect(
      within(additionsCardElement).getByText(valueLabel),
    ).toBeInTheDocument();
    const additionsChange = formatChangeForTest(additionsMetric, "count");
    expect(
      within(additionsCardElement).getByText(
        `${additionsChange.changeLabel} (${additionsChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    const netChange = formatChangeForTest(netMetric, "count");
    expect(
      within(netCardElement).getByText(
        `${netChange.changeLabel} (${netChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });
});
