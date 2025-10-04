import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import { __test__ } from "@/lib/dashboard/analytics";

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

const { summarizeIssueDurations, buildHistorySeries, buildDurationComparison } =
  __test__;

type IssueDurationRow = Parameters<typeof summarizeIssueDurations>[0][number];

function createIssueRow(
  overrides: Partial<IssueDurationRow> & {
    github_created_at: IssueDurationRow["github_created_at"];
    github_closed_at: IssueDurationRow["github_closed_at"];
  },
): IssueDurationRow {
  return {
    id: "test-id",
    data: overrides.data ?? null,
    github_created_at: overrides.github_created_at,
    github_closed_at: overrides.github_closed_at,
  };
}

describe("analytics duration metrics", () => {
  it("summarizes resolution and work durations across parent and child issues", () => {
    const targetProject = "test project";

    const parentIssue = createIssueRow({
      github_created_at: "2024-01-01T00:00:00Z",
      github_closed_at: "2024-01-05T00:00:00Z",
      data: {
        trackedIssues: { totalCount: 1 },
        trackedInIssues: { totalCount: 0 },
        projectStatusHistory: [
          {
            projectTitle: "Test Project",
            status: "In Progress",
            occurredAt: "2024-01-02T00:00:00Z",
          },
          {
            projectTitle: "Test Project",
            status: "Done",
            occurredAt: "2024-01-04T00:00:00Z",
          },
        ],
      },
    });

    const childIssue = createIssueRow({
      github_created_at: "2024-01-03T00:00:00Z",
      github_closed_at: "2024-01-06T00:00:00Z",
      data: {
        trackedIssues: { totalCount: 0 },
        trackedInIssues: { totalCount: 1 },
        projectStatusHistory: [
          {
            projectTitle: "Test Project",
            status: "In Progress",
            occurredAt: "2024-01-03T12:00:00Z",
          },
          {
            projectTitle: "Test Project",
            status: "Done",
            occurredAt: "2024-01-05T12:00:00Z",
          },
        ],
      },
    });

    const orphanIssue = createIssueRow({
      github_created_at: "2024-01-04T00:00:00Z",
      github_closed_at: "2024-01-09T00:00:00Z",
      data: null,
    });

    const summary = summarizeIssueDurations(
      [parentIssue, childIssue, orphanIssue],
      targetProject,
    );

    expect(summary.parentResolution).toBeCloseTo(96, 5);
    expect(summary.childResolution).toBeCloseTo(96, 5);
    expect(summary.parentWork).toBeCloseTo(48, 5);
    expect(summary.childWork).toBeCloseTo(48, 5);
    expect(summary.overallWork).toBeCloseTo(48, 5);
  });

  it("builds five-period history series with normalized values", () => {
    const history = buildHistorySeries([
      10,
      "20" as unknown as number,
      null,
      undefined,
      30,
    ]);
    expect(history).toHaveLength(5);
    expect(history.map((entry) => entry.period)).toEqual([
      "previous4",
      "previous3",
      "previous2",
      "previous",
      "current",
    ]);

    const cardHistory = toCardHistory(history);
    expect(cardHistory).toHaveLength(5);
    expect(cardHistory.map((entry) => entry.value)).toEqual([
      10,
      20,
      null,
      null,
      30,
    ]);
  });

  it("computes absolute and percent changes for duration comparisons", () => {
    const improvement = buildDurationComparison(24, 48, "hours");
    expect(improvement.current).toBe(24);
    expect(improvement.previous).toBe(48);
    expect(improvement.absoluteChange).toBe(-24);
    expect(improvement.percentChange).toBeCloseTo(-50, 5);
    expect(improvement.unit).toBe("hours");

    const regression = buildDurationComparison(72, 36, "hours");
    expect(regression.absoluteChange).toBe(36);
    expect(regression.percentChange).toBeCloseTo(100, 5);

    const noBaseline = buildDurationComparison(12, 0, "hours");
    expect(noBaseline.percentChange).toBeNull();

    const zeroBoth = buildDurationComparison(0, 0, "hours");
    expect(zeroBoth.percentChange).toBe(0);
  });

  it("renders overall resolution and work duration metrics with user-facing labels", () => {
    const resolutionMetric = buildDurationComparison(96, 120, "hours");
    const resolutionHistory = toCardHistory(
      buildHistorySeries([150, 140, 130, 120, 96]),
    );

    const workMetric = buildDurationComparison(48, 36, "hours");
    const workHistory = toCardHistory(buildHistorySeries([28, 30, 32, 36, 48]));

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "평균 해결 시간",
          metric: resolutionMetric,
          format: "hours",
          history: resolutionHistory,
        }),
        createElement(MetricCard, {
          title: "평균 작업 시간",
          metric: workMetric,
          format: "hours",
          history: workHistory,
        }),
      ),
    );

    expect(screen.getByText("평균 해결 시간")).toBeInTheDocument();
    expect(screen.getByText("4.0일")).toBeInTheDocument();
    expect(screen.getByText("24시간 (-20.0%)")).toBeInTheDocument();

    expect(screen.getByText("평균 작업 시간")).toBeInTheDocument();
    expect(screen.getByText("2.0일")).toBeInTheDocument();
    expect(screen.getByText("+12시간 (+33.3%)")).toBeInTheDocument();
  });
});
