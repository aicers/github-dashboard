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

const PERIODS = PERIOD_KEYS;

type IssueCommentSpec = {
  closedAt: string | null;
  comments: number;
};

describe("analytics issue comments metrics", () => {
  let issueNumber = 1;

  beforeEach(async () => {
    issueNumber = 1;
    await resetDashboardTables();
  });

  function buildIssue(params: {
    repository: DbRepository;
    authorId: string | null;
    id: string;
    closedAt: string | null;
    comments: number;
    createdAt?: string;
    state?: DbIssue["state"];
  }): DbIssue {
    const { repository, authorId, id, closedAt, comments, createdAt, state } =
      params;
    const effectiveCreatedAt =
      createdAt ?? (closedAt ? shiftHours(closedAt, -48) : CURRENT_RANGE_START);
    const effectiveState = state ?? (closedAt ? "CLOSED" : "OPEN");
    const updatedAt = closedAt ?? effectiveCreatedAt;

    return {
      id,
      number: issueNumber++,
      repositoryId: repository.id,
      authorId,
      title: id,
      state: effectiveState,
      createdAt: effectiveCreatedAt,
      updatedAt,
      closedAt,
      raw: {
        comments: { totalCount: comments },
        title: id,
      },
    } satisfies DbIssue;
  }

  it("builds average issue comments metric with historical breakdown", async () => {
    const author: DbActor = {
      id: "issue-comments-author",
      login: "issue-comments-author",
      name: "Issue Comments Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);

    const repository: DbRepository = {
      id: "issue-comments-repo",
      name: "issue-comments-repo",
      nameWithOwner: "octo/issue-comments-repo",
      ownerId: author.id,
      raw: { id: "issue-comments-repo" },
    };
    await upsertRepository(repository);

    const periodSpecs: Record<PeriodKey, IssueCommentSpec[]> = {
      previous4: [
        { closedAt: "2023-12-06T10:15:00.000Z", comments: 2 },
        { closedAt: "2023-12-08T21:40:00.000Z", comments: 4 },
      ],
      previous3: [
        { closedAt: "2023-12-13T09:05:00.000Z", comments: 1 },
        { closedAt: "2023-12-14T17:55:00.000Z", comments: 3 },
        { closedAt: "2023-12-15T22:20:00.000Z", comments: 5 },
      ],
      previous2: [
        { closedAt: "2023-12-20T08:40:00.000Z", comments: 0 },
        { closedAt: "2023-12-21T16:10:00.000Z", comments: 2 },
      ],
      previous: [
        { closedAt: "2023-12-27T11:05:00.000Z", comments: 6 },
        { closedAt: "2023-12-29T13:55:00.000Z", comments: 4 },
      ],
      current: [
        { closedAt: "2024-01-02T10:25:00.000Z", comments: 3 },
        { closedAt: "2024-01-04T17:40:00.000Z", comments: 6 },
        { closedAt: "2024-01-06T22:00:00.000Z", comments: 9 },
      ],
    };

    for (const period of PERIODS) {
      const specs = periodSpecs[period];
      for (const [index, spec] of specs.entries()) {
        const issue = buildIssue({
          repository,
          authorId: author.id,
          id: `${repository.id}-${period}-${index + 1}`,
          closedAt: spec.closedAt,
          comments: spec.comments,
        });
        await upsertIssue(issue);
      }
    }

    const openIssue = buildIssue({
      repository,
      authorId: author.id,
      id: `${repository.id}-open-current`,
      closedAt: null,
      comments: 12,
      createdAt: "2024-01-03T11:00:00.000Z",
      state: "OPEN",
    });
    await upsertIssue(openIssue);

    const outOfRangeIssue = buildIssue({
      repository,
      authorId: author.id,
      id: `${repository.id}-outside`,
      closedAt: "2023-11-15T10:00:00.000Z",
      comments: 10,
      createdAt: "2023-11-10T10:00:00.000Z",
    });
    await upsertIssue(outOfRangeIssue);

    const expectedAverages = PERIODS.reduce<Record<PeriodKey, number>>(
      (acc, period) => {
        const values = periodSpecs[period].map((spec) => spec.comments);
        const total = values.reduce((sum, value) => sum + value, 0);
        acc[period] = values.length ? total / values.length : Number.NaN;
        return acc;
      },
      {} as Record<PeriodKey, number>,
    );

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const avgCommentsMetric =
      analytics.organization.metrics.avgCommentsPerIssue;
    const commentsHistory =
      analytics.organization.metricHistory.avgCommentsPerIssue;

    expect(avgCommentsMetric.current).toBeCloseTo(expectedAverages.current, 5);
    expect(avgCommentsMetric.previous).toBeCloseTo(
      expectedAverages.previous,
      5,
    );
    expect(avgCommentsMetric.absoluteChange).toBeCloseTo(
      expectedAverages.current - expectedAverages.previous,
      5,
    );
    const expectedPercentChange =
      expectedAverages.previous === 0
        ? null
        : ((expectedAverages.current - expectedAverages.previous) /
            expectedAverages.previous) *
          100;

    if (expectedPercentChange == null) {
      expect(avgCommentsMetric.percentChange).toBeNull();
    } else {
      expect(avgCommentsMetric.percentChange).toBeCloseTo(
        expectedPercentChange,
        5,
      );
    }

    expect(commentsHistory).toHaveLength(PERIODS.length);
    commentsHistory.forEach((entry, index) => {
      const expectedPeriod = PERIODS[index];
      expect(entry.period).toBe(expectedPeriod);
      expect(entry.value ?? Number.NaN).toBeCloseTo(
        expectedAverages[expectedPeriod],
        5,
      );
    });

    const valueLabel = formatMetricValueForTest(
      { current: avgCommentsMetric.current },
      "ratio",
    );
    const change = formatChangeForTest(avgCommentsMetric, "ratio");

    render(
      createElement(MetricCard, {
        title: "해결된 이슈 평균 댓글",
        metric: avgCommentsMetric,
        format: "ratio",
        history: toCardHistory(commentsHistory),
      }),
    );

    const cardElement = screen
      .getByText("해결된 이슈 평균 댓글")
      .closest('[data-slot="card"]');
    if (!(cardElement instanceof HTMLElement)) {
      throw new Error("issue comments metric card not rendered");
    }

    expect(within(cardElement).getByText(valueLabel)).toBeInTheDocument();
    expect(
      within(cardElement).getByText(
        `${change.changeLabel} (${change.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });

  it("handles zero previous averages without dividing by zero", async () => {
    const author: DbActor = {
      id: "issue-comments-zero-author",
      login: "issue-comments-zero-author",
      name: "Issue Comments Zero Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);

    const repository: DbRepository = {
      id: "issue-comments-zero-repo",
      name: "issue-comments-zero-repo",
      nameWithOwner: "octo/issue-comments-zero-repo",
      ownerId: author.id,
      raw: { id: "issue-comments-zero-repo" },
    };
    await upsertRepository(repository);

    const currentSpecs: IssueCommentSpec[] = [
      { closedAt: "2024-01-02T12:00:00.000Z", comments: 8 },
      { closedAt: "2024-01-05T18:30:00.000Z", comments: 4 },
    ];

    await Promise.all(
      currentSpecs.map((spec, index) =>
        upsertIssue(
          buildIssue({
            repository,
            authorId: author.id,
            id: `${repository.id}-current-${index + 1}`,
            closedAt: spec.closedAt,
            comments: spec.comments,
          }),
        ),
      ),
    );

    const previousOpen = buildIssue({
      repository,
      authorId: author.id,
      id: `${repository.id}-previous-open`,
      closedAt: null,
      comments: 6,
      createdAt: "2023-12-28T09:00:00.000Z",
      state: "OPEN",
    });
    await upsertIssue(previousOpen);

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const avgCommentsMetric =
      analytics.organization.metrics.avgCommentsPerIssue;
    const commentsHistory =
      analytics.organization.metricHistory.avgCommentsPerIssue;

    expect(avgCommentsMetric.current).toBeCloseTo(6, 5);
    expect(avgCommentsMetric.previous).toBe(0);
    expect(avgCommentsMetric.absoluteChange).toBeCloseTo(6, 5);
    expect(avgCommentsMetric.percentChange).toBeNull();

    expect(commentsHistory).toHaveLength(PERIODS.length);
    commentsHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      if (entry.period === "current") {
        expect(entry.value ?? Number.NaN).toBeCloseTo(6, 5);
      } else {
        expect(entry.value).toBe(0);
      }
    });

    const valueLabel = formatMetricValueForTest(
      { current: avgCommentsMetric.current },
      "ratio",
    );
    const change = formatChangeForTest(avgCommentsMetric, "ratio");

    render(
      createElement(MetricCard, {
        title: "해결된 이슈 평균 댓글",
        metric: avgCommentsMetric,
        format: "ratio",
        history: toCardHistory(commentsHistory),
      }),
    );

    const cardElement = screen
      .getByText("해결된 이슈 평균 댓글")
      .closest('[data-slot="card"]');
    if (!(cardElement instanceof HTMLElement)) {
      throw new Error("issue comments metric card not rendered");
    }

    expect(within(cardElement).getByText(valueLabel)).toBeInTheDocument();
    expect(
      within(cardElement).getByText(
        `${change.changeLabel} (${change.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });
});
