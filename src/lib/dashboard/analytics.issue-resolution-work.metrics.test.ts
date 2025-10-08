import { describe, expect, it } from "vitest";
import { __test__ } from "@/lib/dashboard/analytics";
import {
  formatChangeForTest,
  formatMetricValueForTest,
} from "../../../tests/helpers/metric-formatting";

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

    const workMetric = buildDurationComparison(48, 36, "hours");
    const resolutionSnapshot = formatMetricValueForTest(
      { current: resolutionMetric.current, unit: resolutionMetric.unit },
      "hours",
    );
    const resolutionChange = formatChangeForTest(
      resolutionMetric,
      "hours",
      resolutionMetric.unit ?? "hours",
    );
    const workSnapshot = formatMetricValueForTest(
      { current: workMetric.current, unit: workMetric.unit },
      "hours",
    );
    const workChange = formatChangeForTest(
      workMetric,
      "hours",
      workMetric.unit ?? "hours",
    );

    expect(resolutionSnapshot).toBe("4.0일");
    expect(
      `${resolutionChange.changeLabel} (${resolutionChange.percentLabel})`,
    ).toBe("24시간 (-20.0%)");

    expect(workSnapshot).toBe("2.0일");
    expect(`${workChange.changeLabel} (${workChange.percentLabel})`).toBe(
      "+12시간 (+33.3%)",
    );
  });
});
