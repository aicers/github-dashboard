import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PeopleView } from "@/components/dashboard/people-view";
import {
  type DashboardAnalyticsState,
  type FilterState,
  useDashboardAnalytics,
} from "@/components/dashboard/use-dashboard-analytics";
import { PRESETS } from "@/lib/dashboard/date-range";
import type {
  ComparisonValue,
  DashboardAnalytics,
  DurationComparisonValue,
  HeatmapCell,
  LeaderboardEntry,
  LeaderboardSummary,
  MetricHistoryEntry,
  OrganizationAnalytics,
  RepoComparisonRow,
} from "@/lib/dashboard/types";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

vi.mock("@/components/dashboard/use-dashboard-analytics", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/dashboard/use-dashboard-analytics")
  >("@/components/dashboard/use-dashboard-analytics");
  return {
    ...actual,
    useDashboardAnalytics: vi.fn(),
  };
});

vi.mock("@/components/dashboard/activity-heatmap", () => ({
  ActivityHeatmap: () => <div data-testid="activity-heatmap" />,
}));

vi.mock("@/components/dashboard/dashboard-filter-panel", () => ({
  DashboardFilterPanel: ({ children }: { children?: ReactNode }) => (
    <div data-testid="filter-panel">{children}</div>
  ),
}));

vi.mock("@/components/dashboard/metric-card", () => ({
  MetricCard: ({ title }: { title: string }) => (
    <div data-testid="metric-card">{title}</div>
  ),
}));

vi.mock("@/components/dashboard/repo-activity-table", () => ({
  RepoActivityTable: () => <div data-testid="repo-activity-table" />,
}));

const mockUseDashboardAnalytics = vi.mocked(useDashboardAnalytics);

const DEFAULT_RANGE = {
  start: "2024-01-01T00:00:00.000Z",
  end: "2024-01-14T23:59:59.999Z",
} as const;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

function createComparisonValue(
  current: number,
  absoluteChange = 1,
  percentChange = 0.1,
): ComparisonValue {
  return {
    current,
    previous: current - absoluteChange,
    absoluteChange,
    percentChange,
  };
}

function createDurationValue(current: number): DurationComparisonValue {
  return {
    ...createComparisonValue(current),
    unit: "hours",
  };
}

function createMetricHistory(value: number): MetricHistoryEntry[] {
  return [
    {
      period: "current",
      value,
    },
  ];
}

function createOrganizationAnalytics(): OrganizationAnalytics {
  return {
    metrics: {
      issuesCreated: createComparisonValue(120, 10, 0.09),
      issuesClosed: createComparisonValue(110, 8, 0.08),
      issueResolutionTime: createDurationValue(42),
      issueWorkTime: createDurationValue(28),
      parentIssueResolutionTime: createDurationValue(40),
      childIssueResolutionTime: createDurationValue(22),
      parentIssueWorkTime: createDurationValue(32),
      childIssueWorkTime: createDurationValue(18),
      issueBacklogRatio: createComparisonValue(0.32, 0.02, 0.06),
      prsCreated: createComparisonValue(85, 5, 0.07),
      prsMerged: createComparisonValue(80, 6, 0.08),
      prMergeTime: createDurationValue(36),
      mergeWithoutReviewRatio: createComparisonValue(0.14, 0.02, 0.08),
      reviewsCompleted: createComparisonValue(95, 7, 0.08),
      reviewResponseTime: createDurationValue(20),
      reviewParticipation: createComparisonValue(0.54, 0.04, 0.08),
      avgPrSize: createComparisonValue(240, 20, 0.09),
      avgCommentsPerIssue: createComparisonValue(3.5, 0.4, 0.12),
      avgCommentsPerPr: createComparisonValue(4.2, 0.5, 0.13),
      avgReviewsPerPr: createComparisonValue(2.6, 0.3, 0.11),
      totalEvents: createComparisonValue(520, 45, 0.09),
    },
    activityBreakdown: {
      issues: 180,
      pullRequests: 160,
      reviews: 140,
      comments: 110,
    },
    metricHistory: {
      issuesCreated: createMetricHistory(120),
      issuesClosed: createMetricHistory(110),
      issueResolutionTime: createMetricHistory(42),
      issueWorkTime: createMetricHistory(28),
      parentIssueResolutionTime: createMetricHistory(40),
      parentIssueWorkTime: createMetricHistory(32),
      childIssueResolutionTime: createMetricHistory(22),
      childIssueWorkTime: createMetricHistory(18),
      prsCreated: createMetricHistory(85),
      prsMerged: createMetricHistory(80),
      avgPrAdditions: createMetricHistory(200),
      avgPrNet: createMetricHistory(120),
      avgCommentsPerPr: createMetricHistory(4.2),
      avgReviewsPerPr: createMetricHistory(2.6),
      mergeWithoutReviewRatio: createMetricHistory(0.14),
      avgCommentsPerIssue: createMetricHistory(3.5),
      reviewParticipation: createMetricHistory(0.54),
      reviewResponseTime: createMetricHistory(20),
    },
    reviewers: [],
    trends: {
      issuesCreated: [],
      issuesClosed: [],
      prsCreated: [],
      prsMerged: [],
      issueResolutionHours: [],
      reviewHeatmap: [],
    },
    repoDistribution: [],
    repoComparison: [],
  } satisfies OrganizationAnalytics;
}

function createLeaderboardSummary(): LeaderboardSummary {
  const empty: LeaderboardEntry[] = [];
  return {
    prsCreated: empty,
    prsMerged: empty,
    prsMergedBy: empty,
    prCompleteness: empty,
    issuesCreated: empty,
    reviewsCompleted: empty,
    fastestResponders: empty,
    discussionEngagement: empty,
    mainBranchContribution: empty,
    activeReviewerActivity: empty,
    activeMainBranchContribution: empty,
  } satisfies LeaderboardSummary;
}

function createMockAnalytics(): DashboardAnalytics {
  const repository: RepositoryProfile = {
    id: "repo-1",
    name: "Repo One",
    nameWithOwner: "acme/repo-one",
    maintainerIds: [],
  };

  const contributor = {
    id: "user-1",
    login: "octocat",
    name: "Octocat",
    avatarUrl: null,
  } as const;

  const reviewHeatmap: HeatmapCell[] = [
    { day: 1, hour: 10, count: 3 },
    { day: 3, hour: 14, count: 5 },
  ];
  const activityHeatmap: HeatmapCell[] = [
    { day: 2, hour: 9, count: 4 },
    { day: 4, hour: 16, count: 6 },
  ];

  const repoComparison: RepoComparisonRow[] = [
    {
      repositoryId: repository.id,
      repository,
      issuesCreated: 6,
      issuesResolved: 5,
      pullRequestsCreated: 4,
      pullRequestsMerged: 3,
      pullRequestsMergedBy: 2,
      reviews: 7,
      activeReviews: 3,
      comments: 8,
      avgFirstReviewHours: 18,
    },
  ];

  const metrics = {
    issuesCreated: createComparisonValue(8),
    issuesClosed: createComparisonValue(7),
    issueResolutionTime: createDurationValue(36),
    issueWorkTime: createDurationValue(24),
    parentIssueResolutionTime: createDurationValue(40),
    childIssueResolutionTime: createDurationValue(18),
    parentIssueWorkTime: createDurationValue(32),
    childIssueWorkTime: createDurationValue(20),
    prsCreated: createComparisonValue(5),
    prsMerged: createComparisonValue(4),
    prsMergedBy: createComparisonValue(3),
    prCompleteness: createComparisonValue(0.92, 0.02, 0.05),
    reviewsCompleted: createComparisonValue(6),
    activeReviewsCompleted: createComparisonValue(4),
    reviewResponseTime: createDurationValue(12),
    prsReviewed: createComparisonValue(5),
    reviewComments: createComparisonValue(14),
    reviewCoverage: createComparisonValue(0.63, 0.04, 0.07),
    reviewParticipation: createComparisonValue(0.51, 0.05, 0.1),
    reopenedIssues: createComparisonValue(1),
    discussionComments: createComparisonValue(9),
  } as const;

  const metricHistory = {
    issuesCreated: createMetricHistory(8),
    issuesClosed: createMetricHistory(7),
    issueResolutionTime: createMetricHistory(36),
    issueWorkTime: createMetricHistory(24),
    parentIssueResolutionTime: createMetricHistory(40),
    parentIssueWorkTime: createMetricHistory(32),
    childIssueResolutionTime: createMetricHistory(18),
    childIssueWorkTime: createMetricHistory(20),
    prsCreated: createMetricHistory(5),
    prsMerged: createMetricHistory(4),
    prsMergedBy: createMetricHistory(3),
    prCompleteness: createMetricHistory(0.92),
    reviewsCompleted: createMetricHistory(6),
    activeReviewsCompleted: createMetricHistory(4),
    reviewResponseTime: createMetricHistory(12),
    prsReviewed: createMetricHistory(5),
    reviewComments: createMetricHistory(14),
    reviewCoverage: createMetricHistory(0.63),
    reviewParticipation: createMetricHistory(0.51),
    reopenedIssues: createMetricHistory(1),
    discussionComments: createMetricHistory(9),
  } as const;

  return {
    range: {
      start: DEFAULT_RANGE.start,
      end: DEFAULT_RANGE.end,
      previousStart: "2023-12-18T00:00:00.000Z",
      previousEnd: "2023-12-31T23:59:59.999Z",
      previous2Start: "2023-12-04T00:00:00.000Z",
      previous2End: "2023-12-17T23:59:59.999Z",
      previous3Start: "2023-11-20T00:00:00.000Z",
      previous3End: "2023-12-03T23:59:59.999Z",
      previous4Start: "2023-11-06T00:00:00.000Z",
      previous4End: "2023-11-19T23:59:59.999Z",
      intervalDays: 14,
    },
    repositories: [repository],
    contributors: [contributor],
    activeContributors: [contributor],
    organization: createOrganizationAnalytics(),
    individual: {
      person: contributor,
      metrics,
      metricHistory,
      trends: {
        monthly: [],
        repoActivity: [],
        reviewHeatmap,
        activityHeatmap,
      },
      repoComparison,
    },
    leaderboard: createLeaderboardSummary(),
    timeZone: "UTC",
    weekStart: "monday",
    dateTimeFormat: "auto",
    generatedAt: "2024-01-05T00:00:00.000Z",
    lastSyncCompletedAt: "2024-01-05T00:00:00.000Z",
  } satisfies DashboardAnalytics;
}

function createUser(id: string, login: string, name?: string): UserProfile {
  return {
    id,
    login,
    name: name ?? login,
    avatarUrl: null,
  } satisfies UserProfile;
}

function createMockState(): DashboardAnalyticsState {
  const analytics = createMockAnalytics();
  const filters: FilterState = {
    start: DEFAULT_RANGE.start,
    end: DEFAULT_RANGE.end,
    preset: "last_14_days",
    repositoryIds: analytics.repositories.map((repo) => repo.id),
    personId: analytics.contributors[0]?.id ?? null,
  };

  const setFilters =
    vi.fn() as unknown as DashboardAnalyticsState["setFilters"];
  const applyFilters = vi
    .fn()
    .mockResolvedValue(
      undefined,
    ) as unknown as DashboardAnalyticsState["applyFilters"];

  return {
    analytics,
    filters,
    appliedFilters: { ...filters },
    setFilters,
    applyFilters,
    hasPendingChanges: false,
    isLoading: false,
    error: null,
    presets: PRESETS,
    timeZone: analytics.timeZone,
    weekStart: analytics.weekStart,
  } satisfies DashboardAnalyticsState;
}

function buildStateWithContributors({
  contributors,
  activeContributors = [],
  initialPersonId = null,
}: {
  contributors: UserProfile[];
  activeContributors?: UserProfile[];
  initialPersonId?: string | null;
}): DashboardAnalyticsState {
  const base = createMockState();
  const applyFilters = vi.fn().mockResolvedValue(undefined);

  const analytics = {
    ...base.analytics,
    contributors,
    activeContributors,
    individual:
      base.analytics.individual && contributors.length
        ? {
            ...base.analytics.individual,
            person: contributors[0],
          }
        : base.analytics.individual,
  } satisfies DashboardAnalytics;

  const filters: FilterState = {
    ...base.filters,
    personId: initialPersonId,
  };

  return {
    ...base,
    analytics,
    filters,
    appliedFilters: { ...filters },
    applyFilters,
  };
}

describe("PeopleView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays the people dashboard metric labels in the UI", () => {
    const state = createMockState();
    mockUseDashboardAnalytics.mockReturnValue(state);

    render(
      <PeopleView
        initialAnalytics={state.analytics}
        defaultRange={DEFAULT_RANGE}
        currentUserId={state.filters.personId}
      />,
    );

    const metricLabels = [
      "이슈 생성",
      "이슈 종료",
      "평균 해결 시간",
      "평균 작업 시간",
      "Parent 해결 시간",
      "Parent 작업 시간",
      "Child 해결 시간",
      "Child 작업 시간",
      "PR 생성",
      "PR 머지",
      "PR 머지 수행",
      "PR 완성도",
      "리뷰 수행",
      "적극 리뷰 수행",
      "리뷰 응답 시간",
      "PR 리뷰",
      "리뷰 댓글",
      "PR 리뷰 커버리지",
      "리뷰 참여 비율",
      "코멘트 참여",
      "Parent 이슈 해결 시간",
      "Parent 이슈 작업 시간",
      "Child 이슈 해결 시간",
      "Child 이슈 작업 시간",
    ];

    metricLabels.forEach((label) => {
      const elements = screen.getAllByText(label, { exact: true });
      expect(elements.length).toBeGreaterThan(0);
    });

    expect(
      screen.getByText("활동 요약 · octocat", { exact: true }),
    ).toBeInTheDocument();
  });

  it("renders heatmaps and repo activity data for the people dashboard", () => {
    const state = createMockState();
    mockUseDashboardAnalytics.mockReturnValue(state);

    render(
      <PeopleView
        initialAnalytics={state.analytics}
        defaultRange={DEFAULT_RANGE}
        currentUserId={state.filters.personId}
      />,
    );

    expect(screen.getByText("리뷰 활동 히트맵")).toBeInTheDocument();
    expect(screen.getByText("전체 활동 히트맵")).toBeInTheDocument();
    expect(screen.getByText("Parent / Child 이슈 지표")).toBeInTheDocument();
    expect(screen.getByText("활동 저장소")).toBeInTheDocument();
    expect(screen.getAllByTestId("activity-heatmap")).toHaveLength(2);
    expect(screen.getByTestId("repo-activity-table")).toBeInTheDocument();
  });
});

it("orders contributor buttons as octoaide, codecov, dependabot, then others alphabetically", () => {
  const contributors = [
    createUser("user-5", "zeta"),
    createUser("user-2", "dependabot[bot]"),
    createUser("user-3", "octoaide"),
    createUser("user-4", "codecov"),
    createUser("user-6", "alice"),
  ];
  const state = buildStateWithContributors({
    contributors,
    activeContributors: contributors.slice(0, 2),
    initialPersonId: null,
  });
  mockUseDashboardAnalytics.mockReturnValue(state);

  render(
    <PeopleView
      initialAnalytics={state.analytics}
      defaultRange={DEFAULT_RANGE}
      currentUserId="user-99"
    />,
  );

  const selectionSection = screen.getByText("구성원 선택").parentElement;
  expect(selectionSection).not.toBeNull();
  const selectionButtons = within(selectionSection as HTMLElement).getAllByRole(
    "button",
    { name: /.*/ },
  );
  const labels = selectionButtons.map((button) => button.textContent?.trim());
  expect(labels).toEqual([
    "octoaide",
    "codecov",
    "dependabot[bot]",
    "alice",
    "zeta",
  ]);
});

it("auto-selects octoaide even when contributors list does not include it", async () => {
  const contributors = [
    createUser("user-1", "alice"),
    createUser("user-2", "bravo"),
  ];
  const state = buildStateWithContributors({
    contributors,
    activeContributors: [],
    initialPersonId: null,
  });
  mockUseDashboardAnalytics.mockReturnValue(state);

  render(
    <PeopleView
      initialAnalytics={state.analytics}
      defaultRange={DEFAULT_RANGE}
      currentUserId="user-99"
    />,
  );

  await waitFor(() => {
    expect(state.applyFilters).toHaveBeenCalled();
  });
  expect(state.applyFilters).toHaveBeenCalledWith(
    expect.objectContaining({ personId: "octoaide" }),
  );
});

it("auto-selects the current user when they are in the contributors list", async () => {
  const currentUser = createUser("user-self", "selfuser");
  const contributors = [
    createUser("user-1", "alice"),
    currentUser,
    createUser("user-3", "bravo"),
  ];
  const state = buildStateWithContributors({
    contributors,
    activeContributors: [],
    initialPersonId: null,
  });
  mockUseDashboardAnalytics.mockReturnValue(state);

  render(
    <PeopleView
      initialAnalytics={state.analytics}
      defaultRange={DEFAULT_RANGE}
      currentUserId={currentUser.id}
    />,
  );

  await waitFor(() => {
    expect(state.applyFilters).toHaveBeenCalled();
  });
  expect(state.applyFilters).toHaveBeenCalledWith(
    expect.objectContaining({ personId: currentUser.id }),
  );
});
