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
import type { PeriodKey } from "@/lib/dashboard/types";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
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

type EngagementSpec = {
  mergedAt: string;
  comments: number;
  submittedReviews: number;
  pendingReviews?: number;
  authorId?: string;
};

type PeriodStats = Record<
  PeriodKey,
  {
    comments: number;
    reviews: number;
  }
>;

function hoursBefore(iso: string, hours: number) {
  const base = new Date(iso).getTime();
  return new Date(base - hours * 3_600_000).toISOString();
}

function buildPullRequest({
  repository,
  authorId,
  mergedAt,
  comments,
  id,
  number,
}: {
  repository: DbRepository;
  authorId: string;
  mergedAt: string;
  comments: number;
  id: string;
  number: number;
}): DbPullRequest {
  const createdAt = hoursBefore(mergedAt, 18);
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
      comments: { totalCount: comments },
      additions: 0,
      deletions: 0,
      author: { id: authorId },
    },
  };
}

async function insertReviewsForPullRequest({
  pullRequestId,
  submittedCount,
  pendingCount,
  reviewerId,
  submittedAt,
}: {
  pullRequestId: string;
  submittedCount: number;
  pendingCount: number;
  reviewerId: string;
  submittedAt: string;
}) {
  let reviewIndex = 1;
  const insert = async (count: number, submitted: boolean) => {
    for (let index = 0; index < count; index += 1) {
      const review: DbReview = {
        id: `${pullRequestId}-review-${reviewIndex++}`,
        pullRequestId,
        authorId: reviewerId,
        state: submitted ? "APPROVED" : "COMMENTED",
        submittedAt: submitted ? submittedAt : null,
        raw: {},
      };
      await upsertReview(review);
    }
  };

  await insert(submittedCount, true);
  await insert(pendingCount, false);
}

function computePeriodStats(
  specs: EngagementSpec[],
  excludedAuthorId?: string,
): { comments: number; reviews: number } {
  const relevant = specs.filter((spec) => spec.authorId !== excludedAuthorId);
  if (!relevant.length) {
    return { comments: 0, reviews: 0 };
  }

  const commentsSum = relevant.reduce(
    (total, spec) => total + spec.comments,
    0,
  );
  const reviewsSum = relevant.reduce(
    (total, spec) => total + spec.submittedReviews,
    0,
  );

  return {
    comments: commentsSum / relevant.length,
    reviews: reviewsSum / relevant.length,
  };
}

describe("analytics PR engagement metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("builds average PR comments and reviews metrics with histories", async () => {
    const author: DbActor = {
      id: "pr-engagement-author",
      login: "octo-engager",
      name: "Octo Engager",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "pr-engagement-reviewer",
      login: "octo-reviewer",
      name: "Octo Reviewer",
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
    await upsertUser(reviewer);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "pr-engagement-repo",
      name: "pr-engagement-repo",
      nameWithOwner: "octo/pr-engagement-repo",
      ownerId: author.id,
      raw: { id: "pr-engagement-repo" },
    };
    await upsertRepository(repository);

    const periodSpecs: Record<PeriodKey, EngagementSpec[]> = {
      previous4: [
        {
          mergedAt: "2023-12-04T10:00:00.000Z",
          comments: 4,
          submittedReviews: 2,
        },
        {
          mergedAt: "2023-12-06T09:30:00.000Z",
          comments: 2,
          submittedReviews: 1,
          pendingReviews: 1,
        },
      ],
      previous3: [
        {
          mergedAt: "2023-12-11T12:00:00.000Z",
          comments: 6,
          submittedReviews: 3,
        },
        {
          mergedAt: "2023-12-13T15:15:00.000Z",
          comments: 3,
          submittedReviews: 2,
          pendingReviews: 2,
        },
      ],
      previous2: [
        {
          mergedAt: "2023-12-18T17:30:00.000Z",
          comments: 5,
          submittedReviews: 1,
        },
        {
          mergedAt: "2023-12-19T19:45:00.000Z",
          comments: 7,
          submittedReviews: 4,
        },
      ],
      previous: [
        {
          mergedAt: "2023-12-26T11:05:00.000Z",
          comments: 8,
          submittedReviews: 3,
        },
        {
          mergedAt: "2023-12-28T20:25:00.000Z",
          comments: 5,
          submittedReviews: 2,
          pendingReviews: 1,
        },
        {
          mergedAt: "2023-12-29T09:40:00.000Z",
          comments: 10,
          submittedReviews: 4,
          authorId: dependabot.id,
        },
      ],
      current: [
        {
          mergedAt: "2024-01-02T09:50:00.000Z",
          comments: 7,
          submittedReviews: 3,
        },
        {
          mergedAt: "2024-01-04T14:20:00.000Z",
          comments: 9,
          submittedReviews: 4,
          pendingReviews: 1,
        },
        {
          mergedAt: "2024-01-05T18:35:00.000Z",
          comments: 6,
          submittedReviews: 5,
          authorId: dependabot.id,
        },
      ],
    };

    let pullNumber = 1;
    for (const period of PERIODS) {
      const specs = periodSpecs[period];
      for (const [index, spec] of specs.entries()) {
        const authorId = spec.authorId ?? author.id;
        const pullRequest = buildPullRequest({
          repository,
          authorId,
          mergedAt: spec.mergedAt,
          comments: spec.comments,
          id: `${repository.id}-${period}-${index + 1}`,
          number: pullNumber++,
        });
        await upsertPullRequest(pullRequest);
        await insertReviewsForPullRequest({
          pullRequestId: pullRequest.id,
          submittedCount: spec.submittedReviews,
          pendingCount: spec.pendingReviews ?? 0,
          reviewerId: reviewer.id,
          submittedAt: spec.mergedAt,
        });
      }
    }

    const outOfRange = buildPullRequest({
      repository,
      authorId: author.id,
      mergedAt: "2023-11-20T10:00:00.000Z",
      comments: 12,
      id: `${repository.id}-out-of-range`,
      number: pullNumber++,
    });
    await upsertPullRequest(outOfRange);
    await insertReviewsForPullRequest({
      pullRequestId: outOfRange.id,
      submittedCount: 6,
      pendingCount: 0,
      reviewerId: reviewer.id,
      submittedAt: "2023-11-20T10:00:00.000Z",
    });

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const stats: PeriodStats = PERIODS.reduce((acc, period) => {
      acc[period] = computePeriodStats(periodSpecs[period], dependabot.id);
      return acc;
    }, {} as PeriodStats);

    const avgCommentsMetric = analytics.organization.metrics.avgCommentsPerPr;
    const avgReviewsMetric = analytics.organization.metrics.avgReviewsPerPr;

    const expectedCommentsCurrent = stats.current.comments;
    const expectedCommentsPrevious = stats.previous.comments;
    const expectedReviewsCurrent = stats.current.reviews;
    const expectedReviewsPrevious = stats.previous.reviews;

    expect(avgCommentsMetric.current).toBeCloseTo(expectedCommentsCurrent, 5);
    expect(avgCommentsMetric.previous).toBeCloseTo(expectedCommentsPrevious, 5);
    expect(avgCommentsMetric.absoluteChange).toBeCloseTo(
      expectedCommentsCurrent - expectedCommentsPrevious,
      5,
    );
    const expectedCommentsPercent =
      expectedCommentsPrevious === 0
        ? null
        : ((expectedCommentsCurrent - expectedCommentsPrevious) /
            expectedCommentsPrevious) *
          100;
    expect(avgCommentsMetric.percentChange).toBeCloseTo(
      expectedCommentsPercent ?? 0,
      5,
    );

    expect(avgReviewsMetric.current).toBeCloseTo(expectedReviewsCurrent, 5);
    expect(avgReviewsMetric.previous).toBeCloseTo(expectedReviewsPrevious, 5);
    expect(avgReviewsMetric.absoluteChange).toBeCloseTo(
      expectedReviewsCurrent - expectedReviewsPrevious,
      5,
    );
    const expectedReviewsPercent =
      expectedReviewsPrevious === 0
        ? null
        : ((expectedReviewsCurrent - expectedReviewsPrevious) /
            expectedReviewsPrevious) *
          100;
    expect(avgReviewsMetric.percentChange).toBeCloseTo(
      expectedReviewsPercent ?? 0,
      5,
    );

    const commentsHistory =
      analytics.organization.metricHistory.avgCommentsPerPr;
    const expectedCommentsHistory = PERIODS.map(
      (period) => stats[period].comments,
    );
    commentsHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      expect(entry.value ?? Number.NaN).toBeCloseTo(
        expectedCommentsHistory[index],
        5,
      );
    });

    const reviewsHistory = analytics.organization.metricHistory.avgReviewsPerPr;
    const expectedReviewsHistory = PERIODS.map(
      (period) => stats[period].reviews,
    );
    reviewsHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      expect(entry.value ?? Number.NaN).toBeCloseTo(
        expectedReviewsHistory[index],
        5,
      );
    });

    const commentsValueLabel = formatMetricValueForTest(
      { current: avgCommentsMetric.current },
      "ratio",
    );
    const reviewsValueLabel = formatMetricValueForTest(
      { current: avgReviewsMetric.current },
      "ratio",
    );

    const commentsChange = formatChangeForTest(avgCommentsMetric, "ratio");
    const reviewsChange = formatChangeForTest(avgReviewsMetric, "ratio");

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 평균 댓글",
          metric: avgCommentsMetric,
          format: "ratio",
          history: toCardHistory(commentsHistory),
        }),
        createElement(MetricCard, {
          title: "PR 평균 리뷰",
          metric: avgReviewsMetric,
          format: "ratio",
          history: toCardHistory(reviewsHistory),
        }),
      ),
    );

    const commentsCardElement = screen
      .getByText("PR 평균 댓글")
      .closest('[data-slot="card"]');
    const reviewsCardElement = screen
      .getByText("PR 평균 리뷰")
      .closest('[data-slot="card"]');

    if (!(commentsCardElement instanceof HTMLElement)) {
      throw new Error("engagement metric cards not rendered");
    }
    if (!(reviewsCardElement instanceof HTMLElement)) {
      throw new Error("engagement metric cards not rendered");
    }

    const commentsCard = commentsCardElement;
    const reviewsCard = reviewsCardElement;

    expect(
      within(commentsCard).getByText(commentsValueLabel),
    ).toBeInTheDocument();
    expect(
      within(commentsCard).getByText(
        `${commentsChange.changeLabel} (${commentsChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    expect(
      within(reviewsCard).getByText(reviewsValueLabel),
    ).toBeInTheDocument();
    expect(
      within(reviewsCard).getByText(
        `${reviewsChange.changeLabel} (${reviewsChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });

  it("handles zero previous engagement averages", async () => {
    const author: DbActor = {
      id: "pr-engagement-zero-author",
      login: "octo-zero-author",
      name: "Octo Zero Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "pr-engagement-zero-reviewer",
      login: "octo-zero-reviewer",
      name: "Octo Zero Reviewer",
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
    await upsertUser(reviewer);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "pr-engagement-zero-repo",
      name: "pr-engagement-zero-repo",
      nameWithOwner: "octo/pr-engagement-zero-repo",
      ownerId: author.id,
      raw: { id: "pr-engagement-zero-repo" },
    };
    await upsertRepository(repository);

    const currentSpecs: EngagementSpec[] = [
      {
        mergedAt: "2024-01-03T10:00:00.000Z",
        comments: 4,
        submittedReviews: 2,
      },
      {
        mergedAt: "2024-01-05T16:15:00.000Z",
        comments: 6,
        submittedReviews: 3,
        pendingReviews: 1,
      },
      {
        mergedAt: "2024-01-04T12:20:00.000Z",
        comments: 7,
        submittedReviews: 5,
        authorId: dependabot.id,
      },
    ];

    let pullNumber = 1;
    for (const [index, spec] of currentSpecs.entries()) {
      const authorId = spec.authorId ?? author.id;
      const pullRequest = buildPullRequest({
        repository,
        authorId,
        mergedAt: spec.mergedAt,
        comments: spec.comments,
        id: `${repository.id}-current-${index + 1}`,
        number: pullNumber++,
      });
      await upsertPullRequest(pullRequest);
      await insertReviewsForPullRequest({
        pullRequestId: pullRequest.id,
        submittedCount: spec.submittedReviews,
        pendingCount: spec.pendingReviews ?? 0,
        reviewerId: reviewer.id,
        submittedAt: spec.mergedAt,
      });
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const avgCommentsMetric = analytics.organization.metrics.avgCommentsPerPr;
    const avgReviewsMetric = analytics.organization.metrics.avgReviewsPerPr;

    expect(avgCommentsMetric.previous).toBe(0);
    expect(avgCommentsMetric.percentChange).toBeNull();
    expect(avgReviewsMetric.previous).toBe(0);
    expect(avgReviewsMetric.percentChange).toBeNull();

    const commentsHistory =
      analytics.organization.metricHistory.avgCommentsPerPr;
    const reviewsHistory = analytics.organization.metricHistory.avgReviewsPerPr;

    commentsHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      if (entry.period === "current") {
        expect(entry.value ?? Number.NaN).toBeCloseTo(5, 5);
      } else {
        expect(entry.value).toBe(0);
      }
    });

    reviewsHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      if (entry.period === "current") {
        expect(entry.value ?? Number.NaN).toBeCloseTo(2.5, 5);
      } else {
        expect(entry.value).toBe(0);
      }
    });

    const commentsValueLabel = formatMetricValueForTest(
      { current: avgCommentsMetric.current },
      "ratio",
    );
    const reviewsValueLabel = formatMetricValueForTest(
      { current: avgReviewsMetric.current },
      "ratio",
    );

    const commentsChange = formatChangeForTest(avgCommentsMetric, "ratio");
    const reviewsChange = formatChangeForTest(avgReviewsMetric, "ratio");

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 평균 댓글",
          metric: avgCommentsMetric,
          format: "ratio",
          history: toCardHistory(
            analytics.organization.metricHistory.avgCommentsPerPr,
          ),
        }),
        createElement(MetricCard, {
          title: "PR 평균 리뷰",
          metric: avgReviewsMetric,
          format: "ratio",
          history: toCardHistory(
            analytics.organization.metricHistory.avgReviewsPerPr,
          ),
        }),
      ),
    );

    const commentsCardElement = screen
      .getByText("PR 평균 댓글")
      .closest('[data-slot="card"]');
    const reviewsCardElement = screen
      .getByText("PR 평균 리뷰")
      .closest('[data-slot="card"]');

    if (!(commentsCardElement instanceof HTMLElement)) {
      throw new Error("zero baseline engagement cards not rendered");
    }
    if (!(reviewsCardElement instanceof HTMLElement)) {
      throw new Error("zero baseline engagement cards not rendered");
    }

    const commentsCard = commentsCardElement;
    const reviewsCard = reviewsCardElement;

    expect(
      within(commentsCard).getByText(commentsValueLabel),
    ).toBeInTheDocument();
    expect(
      within(commentsCard).getByText(
        `${commentsChange.changeLabel} (${commentsChange.percentLabel})`,
      ),
    ).toBeInTheDocument();

    expect(
      within(reviewsCard).getByText(reviewsValueLabel),
    ).toBeInTheDocument();
    expect(
      within(reviewsCard).getByText(
        `${reviewsChange.changeLabel} (${reviewsChange.percentLabel})`,
      ),
    ).toBeInTheDocument();
  });
});
