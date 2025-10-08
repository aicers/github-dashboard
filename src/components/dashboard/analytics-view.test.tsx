import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, test, vi } from "vitest";

import { AnalyticsView } from "@/components/dashboard/analytics-view";
import {
  type DashboardAnalyticsState,
  useDashboardAnalytics,
} from "@/components/dashboard/use-dashboard-analytics";
import { buildRangeFromPreset, PRESETS } from "@/lib/dashboard/date-range";
import { formatDuration } from "@/lib/dashboard/metric-formatters";
import { buildNetTrend, mergeTrends } from "@/lib/dashboard/trend-utils";
import type {
  ComparisonValue,
  DashboardAnalytics,
  DurationComparisonValue,
  LeaderboardEntry,
  MetricHistoryEntry,
  RatioComparisonValue,
} from "@/lib/dashboard/types";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

vi.mock("@/components/dashboard/use-dashboard-analytics", () => ({
  useDashboardAnalytics: vi.fn(),
}));

vi.mock("recharts", () => {
  const { createElement } = require("react") as typeof import("react");

  const createStub =
    (testId: string) =>
    ({ children }: { children?: import("react").ReactNode }) =>
      createElement("div", { "data-testid": testId }, children ?? null);

  const NullComponent = () => null;

  return {
    ResponsiveContainer: createStub("recharts-responsive"),
    LineChart: createStub("recharts-line-chart"),
    Line: () => createElement("div", { "data-testid": "recharts-line" }),
    CartesianGrid: NullComponent,
    Legend: NullComponent,
    ReferenceLine: NullComponent,
    Tooltip: NullComponent,
    XAxis: NullComponent,
    YAxis: NullComponent,
  };
});

const mockUseDashboardAnalytics = vi.mocked(useDashboardAnalytics);

type TextMatcher = string | RegExp;

function findCardByTitle(title: string, valueMatcher?: TextMatcher) {
  const titleElements = screen.getAllByText(title);
  const cards = titleElements
    .map((titleElement) => titleElement.closest('[data-slot="card"]'))
    .filter((card): card is HTMLElement => card != null);
  if (valueMatcher == null) {
    const [firstCard] = cards;
    if (!firstCard) {
      throw new Error(`Card with title ${title} not found.`);
    }
    return firstCard;
  }

  const matchedCard = cards.find((card) =>
    within(card).queryByText(valueMatcher),
  );
  if (!matchedCard) {
    throw new Error(
      `Card with title ${title} matching value ${valueMatcher.toString()} not found.`,
    );
  }
  return matchedCard;
}

function expectCardValue(title: string, value: TextMatcher) {
  const card = findCardByTitle(title, value);
  expect(within(card).getByText(value)).toBeInTheDocument();
}

function createComparisonValue(
  current: number,
  previous = current,
  extra: Partial<ComparisonValue> = {},
): ComparisonValue {
  const absoluteChange = current - previous;
  const percentChange = previous === 0 ? null : absoluteChange / previous;
  return {
    current,
    previous,
    absoluteChange,
    percentChange,
    ...extra,
  };
}

function createDurationValue(
  current: number,
  previous = current,
  unit: DurationComparisonValue["unit"] = "hours",
): DurationComparisonValue {
  return {
    ...createComparisonValue(current, previous),
    unit,
  };
}

function createRatioValue(current: number, previous = current) {
  return createComparisonValue(current, previous) as RatioComparisonValue;
}

function createHistory(current: number): MetricHistoryEntry[] {
  return [{ period: "current", value: current }];
}

function createUser(id: string, login: string): UserProfile {
  return {
    id,
    login,
    name: `${login} 이름`,
    avatarUrl: `https://example.com/${id}.png`,
  };
}

function createRepository(id: string, name: string): RepositoryProfile {
  return {
    id,
    name,
    nameWithOwner: `org/${name}`,
  };
}

function createLeaderboardEntry(
  user: UserProfile,
  value: number,
  extra: Partial<LeaderboardEntry> = {},
): LeaderboardEntry {
  return {
    user,
    value,
    ...extra,
  };
}

function buildDashboardAnalytics(): DashboardAnalytics {
  const repositoryAlpha = createRepository("repo-1", "alpha");
  const repositoryBeta = createRepository("repo-2", "beta");
  const repositories = [repositoryAlpha, repositoryBeta];
  const contributors = [
    createUser("contrib-1", "contrib1"),
    createUser("contrib-2", "contrib2"),
  ];
  const reviewerProfile = createUser("reviewer-1", "reviewer1");
  const reviewerProfileB = createUser("reviewer-2", "reviewer2");
  const mainBranchProfile = createUser("maintainer-1", "maintainer1");
  const mainBranchProfileB = createUser("maintainer-2", "maintainer2");

  const range: DashboardAnalytics["range"] = {
    start: "2024-01-01",
    end: "2024-01-07",
    previousStart: "2023-12-25",
    previousEnd: "2023-12-31",
    previous2Start: "2023-12-18",
    previous2End: "2023-12-24",
    previous3Start: "2023-12-11",
    previous3End: "2023-12-17",
    previous4Start: "2023-12-04",
    previous4End: "2023-12-10",
    intervalDays: 7,
  };

  const organization: DashboardAnalytics["organization"] = {
    metrics: {
      issuesCreated: createComparisonValue(42),
      issuesClosed: createComparisonValue(40),
      issueResolutionTime: createDurationValue(36),
      issueWorkTime: createDurationValue(28),
      parentIssueResolutionTime: createDurationValue(48),
      childIssueResolutionTime: createDurationValue(30),
      parentIssueWorkTime: createDurationValue(20),
      childIssueWorkTime: createDurationValue(18),
      issueBacklogRatio: createRatioValue(0.4),
      prsCreated: createComparisonValue(25),
      prsMerged: createComparisonValue(22),
      prMergeTime: createDurationValue(24),
      mergeWithoutReviewRatio: createRatioValue(0.12),
      reviewsCompleted: createComparisonValue(31),
      reviewResponseTime: createDurationValue(12),
      reviewParticipation: createRatioValue(0.76),
      avgPrSize: {
        ...createComparisonValue(210),
        breakdown: [
          {
            key: "additions",
            label: "+ 합계",
            current: 260,
            previous: 240,
          },
          {
            key: "deletions",
            label: "- 합계",
            current: 50,
            previous: 45,
          },
        ],
      },
      avgCommentsPerIssue: createComparisonValue(1.8),
      avgCommentsPerPr: createComparisonValue(3.2),
      avgReviewsPerPr: createComparisonValue(1.4),
      totalEvents: createComparisonValue(310),
    },
    activityBreakdown: {
      issues: 120,
      pullRequests: 90,
      reviews: 70,
      comments: 30,
    },
    metricHistory: {
      issuesCreated: createHistory(42),
      issuesClosed: createHistory(40),
      issueResolutionTime: createHistory(36),
      issueWorkTime: createHistory(28),
      parentIssueResolutionTime: createHistory(48),
      parentIssueWorkTime: createHistory(20),
      childIssueResolutionTime: createHistory(30),
      childIssueWorkTime: createHistory(18),
      prsCreated: createHistory(25),
      prsMerged: createHistory(22),
      avgPrAdditions: createHistory(260),
      avgPrNet: createHistory(210),
      avgCommentsPerPr: createHistory(3.2),
      avgReviewsPerPr: createHistory(1.4),
      mergeWithoutReviewRatio: createHistory(0.12),
      avgCommentsPerIssue: createHistory(1.8),
      reviewParticipation: createHistory(0.76),
      reviewResponseTime: createHistory(12),
    },
    reviewers: [
      {
        reviewerId: reviewerProfile.id,
        reviewCount: 14,
        pullRequestsReviewed: 9,
        activeReviewCount: 6,
        profile: reviewerProfile,
      },
      {
        reviewerId: reviewerProfileB.id,
        reviewCount: 8,
        pullRequestsReviewed: 5,
        activeReviewCount: 3,
        profile: reviewerProfileB,
      },
    ],
    trends: {
      issuesCreated: [
        { date: "2024-01-01", value: 6 },
        { date: "2024-01-02", value: 5 },
      ],
      issuesClosed: [
        { date: "2024-01-01", value: 4 },
        { date: "2024-01-02", value: 3 },
      ],
      prsCreated: [
        { date: "2024-01-01", value: 3 },
        { date: "2024-01-02", value: 4 },
      ],
      prsMerged: [
        { date: "2024-01-01", value: 2 },
        { date: "2024-01-02", value: 3 },
      ],
      issueResolutionHours: [{ date: "2024-01-01", values: { backlog: 6 } }],
      reviewHeatmap: [{ day: 1, hour: 10, count: 2 }],
    },
    repoDistribution: [
      {
        repositoryId: repositoryAlpha.id,
        repository: repositoryAlpha,
        totalEvents: 40,
        issues: 15,
        pullRequests: 12,
        reviews: 8,
        comments: 5,
        share: 0.4,
      },
    ],
    repoComparison: [
      {
        repositoryId: repositoryAlpha.id,
        repository: repositoryAlpha,
        issuesCreated: 10,
        issuesResolved: 8,
        pullRequestsCreated: 6,
        pullRequestsMerged: 5,
        pullRequestsMergedBy: 4,
        reviews: 7,
        activeReviews: 5,
        comments: 12,
        avgFirstReviewHours: 20,
      },
      {
        repositoryId: repositoryBeta.id,
        repository: repositoryBeta,
        issuesCreated: 8,
        issuesResolved: 6,
        pullRequestsCreated: 4,
        pullRequestsMerged: 3,
        pullRequestsMergedBy: 2,
        reviews: 5,
        activeReviews: 3,
        comments: 9,
        avgFirstReviewHours: 30,
      },
    ],
  };

  const fastestResponder = createUser("responder-1", "responder1");
  const issueLeader = createUser("issuer-1", "issuer1");
  const prCreator = createUser("creator-1", "creator1");
  const prMerger = createUser("merger-1", "merger1");
  const prCompleter = createUser("finisher-1", "finisher1");
  const prExecutor = createUser("executor-1", "executor1");
  const discussionUser = createUser("discuss-1", "commenter1");

  const leaderboard: DashboardAnalytics["leaderboard"] = {
    prsCreated: [createLeaderboardEntry(prCreator, 15)],
    prsMerged: [
      createLeaderboardEntry(prMerger, 13, {
        details: [
          { label: "+", value: 180, suffix: "라인" },
          { label: "-", value: 40, suffix: "라인" },
        ],
      }),
    ],
    prsMergedBy: [createLeaderboardEntry(prExecutor, 11)],
    prCompleteness: [
      createLeaderboardEntry(prCompleter, 1.2, {
        secondaryValue: 10,
      }),
    ],
    issuesCreated: [createLeaderboardEntry(issueLeader, 18)],
    reviewsCompleted: [createLeaderboardEntry(reviewerProfile, 12)],
    fastestResponders: [
      createLeaderboardEntry(fastestResponder, 5.5, {
        secondaryValue: 8,
      }),
    ],
    discussionEngagement: [createLeaderboardEntry(discussionUser, 9)],
    mainBranchContribution: [
      createLeaderboardEntry(mainBranchProfile, 7, {
        details: [
          { label: "+", value: 120, suffix: "라인" },
          { label: "-", value: 20, suffix: "라인" },
        ],
        secondaryValue: 5,
      }),
    ],
    activeReviewerActivity: [
      createLeaderboardEntry(reviewerProfile, 6),
      createLeaderboardEntry(reviewerProfileB, 4),
    ],
    activeMainBranchContribution: [
      createLeaderboardEntry(mainBranchProfileB, 5, {
        secondaryValue: 3,
      }),
    ],
  };

  return {
    range,
    repositories,
    contributors,
    activeContributors: contributors,
    organization,
    individual: null,
    leaderboard,
    timeZone: "Asia/Seoul",
    weekStart: "monday",
  };
}

function createDashboardAnalyticsState(): DashboardAnalyticsState {
  const analytics = buildDashboardAnalytics();
  return {
    analytics,
    filters: {
      start: analytics.range.start,
      end: analytics.range.end,
      preset: "last_14_days",
      repositoryIds: analytics.repositories.map((repo) => repo.id),
      personId: null,
    },
    setFilters: vi.fn(),
    applyFilters: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
    presets: PRESETS,
    timeZone: analytics.timeZone,
    weekStart: analytics.weekStart,
  };
}

function renderAnalyticsView(overrides?: DashboardAnalyticsState) {
  const state = overrides ?? createDashboardAnalyticsState();
  mockUseDashboardAnalytics.mockReturnValue(state);
  const { start, end } = state.analytics.range;
  render(
    <AnalyticsView
      initialAnalytics={state.analytics}
      defaultRange={{ start, end }}
      orgName="테스트 조직"
    />,
  );
  return state;
}

describe("analytics-view helpers", () => {
  test("formatDuration renders hours and days appropriately", () => {
    expect(formatDuration(12, "hours")).toBe("12시간");
    expect(formatDuration(72, "hours")).toBe("3.0일");
    expect(formatDuration(48, "days")).toBe("2.0일");
  });

  test("buildRangeFromPreset computes expected ranges", () => {
    const reference = new Date("2024-05-15T12:00:00Z");
    const last14 = buildRangeFromPreset(
      "last_14_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last14).not.toBeNull();
    const startIso = last14?.start ?? null;
    const endIso = last14?.end ?? null;
    if (startIso && endIso) {
      const start = new Date(startIso);
      const end = new Date(endIso);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(13.9);
      expect(diffDays).toBeLessThanOrEqual(14.1);
    }

    const last30 = buildRangeFromPreset(
      "last_30_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last30).not.toBeNull();
    const last30Start = last30?.start ?? null;
    const last30End = last30?.end ?? null;
    if (last30Start && last30End) {
      const start = new Date(last30Start);
      const end = new Date(last30End);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(28.9);
      expect(diffDays).toBeLessThanOrEqual(30.1);
    }

    const last60 = buildRangeFromPreset(
      "last_60_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last60).not.toBeNull();
    const last60Start = last60?.start ?? null;
    const last60End = last60?.end ?? null;
    if (last60Start && last60End) {
      const start = new Date(last60Start);
      const end = new Date(last60End);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(58.9);
      expect(diffDays).toBeLessThanOrEqual(60.1);
    }

    const last90 = buildRangeFromPreset(
      "last_90_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last90).not.toBeNull();
    const last90Start = last90?.start ?? null;
    const last90End = last90?.end ?? null;
    if (last90Start && last90End) {
      const start = new Date(last90Start);
      const end = new Date(last90End);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(88.9);
      expect(diffDays).toBeLessThanOrEqual(90.1);
    }

    const thisMonth = buildRangeFromPreset(
      "this_month",
      "UTC",
      "monday",
      reference,
    );
    expect(thisMonth).not.toBeNull();
    const monthStartIso = thisMonth?.start ?? null;
    const monthEndIso = thisMonth?.end ?? null;
    if (monthStartIso && monthEndIso) {
      const start = new Date(monthStartIso);
      const end = new Date(monthEndIso);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThanOrEqual(27);
      expect(diffDays).toBeLessThanOrEqual(31);
    }

    const mondayWeek = buildRangeFromPreset(
      "this_week",
      "UTC",
      "monday",
      reference,
    );
    const sundayWeek = buildRangeFromPreset(
      "this_week",
      "UTC",
      "sunday",
      reference,
    );
    expect(mondayWeek).not.toBeNull();
    expect(sundayWeek).not.toBeNull();
    if (mondayWeek && sundayWeek) {
      expect(mondayWeek.start).not.toEqual(sundayWeek.start);
    }
  });

  test("mergeTrends combines series by date", () => {
    const merged = mergeTrends(
      [
        { date: "2024-01-01", value: 3 },
        { date: "2024-01-02", value: 5 },
      ],
      [
        { date: "2024-01-02", value: 4 },
        { date: "2024-01-03", value: 2 },
      ],
      "left",
      "right",
    );

    expect(merged).toEqual([
      { date: "2024-01-01", left: 3, right: 0 },
      { date: "2024-01-02", left: 5, right: 4 },
      { date: "2024-01-03", left: 0, right: 2 },
    ]);
  });

  test("buildNetTrend computes issue net deltas across the selected range", () => {
    const dateKeys = ["2024-01-01", "2024-01-02", "2024-01-03"];

    const issuesCreated = [
      { date: "2024-01-01", value: 5 },
      { date: "2024-01-02", value: 2 },
    ];
    const issuesClosed = [
      { date: "2024-01-01", value: 1 },
      { date: "2024-01-03", value: 4 },
    ];

    const merged = mergeTrends(
      issuesCreated,
      issuesClosed,
      "created",
      "closed",
    );
    const netTrend = buildNetTrend(dateKeys, merged, "created", "closed");

    expect(netTrend).toEqual([
      { date: "2024-01-01", delta: 4 },
      { date: "2024-01-02", delta: 2 },
      { date: "2024-01-03", delta: -4 },
    ]);
  });

  test("buildNetTrend normalizes PR deltas when data is missing or non-finite", () => {
    const dateKeys = ["2024-02-10", "2024-02-11", "2024-02-12"];

    const prsCreated = [
      { date: "2024-02-10", value: 3 },
      { date: "2024-02-11T09:30:00Z", value: 4 },
    ];
    const prsMerged = [
      { date: "2024-02-10", value: 5 },
      { date: "2024-02-11", value: Number.NaN },
    ];

    const merged = mergeTrends(prsCreated, prsMerged, "created", "merged");
    const netTrend = buildNetTrend(dateKeys, merged, "created", "merged");

    expect(netTrend).toEqual([
      { date: "2024-02-10", delta: -2 },
      { date: "2024-02-11", delta: 4 },
      { date: "2024-02-12", delta: 0 },
    ]);
  });
});

describe("AnalyticsView UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders organization metric cards with current values", () => {
    renderAnalyticsView();

    const metricExpectations: Array<{ title: string; value: TextMatcher }> = [
      { title: "이슈 생성", value: "42" },
      { title: "이슈 종료", value: "40" },
      { title: "평균 해결 시간", value: "36시간" },
      { title: "평균 작업 시간", value: "28시간" },
      { title: "PR 생성", value: "25" },
      { title: "PR 머지", value: "22" },
      { title: "PR 평균 크기", value: "+260.0 / -50.0 라인" },
      { title: "PR 평균 댓글", value: "3.20" },
      { title: "PR 평균 리뷰", value: "1.40" },
      { title: "리뷰 참여 비율", value: "76.0%" },
      { title: "리뷰 응답 시간", value: "12시간" },
      { title: "리뷰 없는 머지 비율", value: "12.0%" },
      { title: "해결된 이슈 평균 댓글", value: "1.80" },
      { title: "Parent 이슈 해결 시간", value: "2.0일" },
      { title: "Parent 이슈 작업 시간", value: "20시간" },
      { title: "Child 이슈 해결 시간", value: "30시간" },
      { title: "Child 이슈 작업 시간", value: "18시간" },
    ];

    metricExpectations.forEach(({ title, value }) => {
      expectCardValue(title, value);
    });
  });

  it("renders trend, heatmap, and comparison sections tied to analytics", () => {
    renderAnalyticsView();

    const sectionTitles = [
      "이슈 순증 추이",
      "PR 순증 추이",
      "리뷰 활동 히트맵",
      "리포지토리 비교",
    ];

    sectionTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    expect(screen.getByText(/GitHub 활동 분석/)).toBeInTheDocument();
    expect(
      screen.getByText("테스트 조직 조직의 활동 지표"),
    ).toBeInTheDocument();

    const repoComparisonCard = findCardByTitle("리포지토리 비교");
    const repoAlphaRow = within(repoComparisonCard)
      .getByText("org/alpha")
      .closest("tr");
    expect(repoAlphaRow).not.toBeNull();
    const alphaCells = within(repoAlphaRow as HTMLTableRowElement)
      .getAllByRole("cell")
      .map((cell) => cell.textContent?.trim() ?? "");
    expect(alphaCells).toEqual([
      "org/alpha",
      "10",
      "8",
      "6",
      "5",
      "7",
      "5",
      "12",
      "20시간",
    ]);

    const repoBetaRow = within(repoComparisonCard)
      .getByText("org/beta")
      .closest("tr");
    expect(repoBetaRow).not.toBeNull();
    const betaCells = within(repoBetaRow as HTMLTableRowElement)
      .getAllByRole("cell")
      .map((cell) => cell.textContent?.trim() ?? "");
    expect(betaCells).toEqual([
      "org/beta",
      "8",
      "6",
      "4",
      "3",
      "5",
      "3",
      "9",
      "30시간",
    ]);

    expect(screen.getByTitle(/월 10시: 2\s*리뷰/)).toBeInTheDocument();
  });

  it("renders leaderboard titles for analytics leaderboards", () => {
    renderAnalyticsView();

    const leaderboardHeading = screen.getByText("리더보드");
    const leaderboardSection = leaderboardHeading.closest("section");
    expect(leaderboardSection).not.toBeNull();
    const scoped = within(leaderboardSection as HTMLElement);

    const leaderboardTitles = [
      "적극 리뷰어 활동",
      "리뷰어 활동",
      "적극 메인 브랜치 기여",
      "메인 브랜치 기여",
      "빠른 리뷰 응답",
      "이슈 생성",
      "PR 생성",
      "PR 머지",
      "PR 머지 수행",
      "PR 완성도",
      "코멘트 참여",
    ];

    leaderboardTitles.forEach((title) => {
      expect(scoped.getByText(title)).toBeInTheDocument();
    });

    const reviewerActivityCard = findCardByTitle("리뷰어 활동", "14건");
    expect(
      within(reviewerActivityCard).getByText("reviewer1"),
    ).toBeInTheDocument();
    expect(within(reviewerActivityCard).getByText("14건")).toBeInTheDocument();
    expect(
      within(reviewerActivityCard).getByText("참여 PR 9건"),
    ).toBeInTheDocument();
    expect(
      within(reviewerActivityCard).getByText("reviewer2"),
    ).toBeInTheDocument();
    expect(within(reviewerActivityCard).getByText("8건")).toBeInTheDocument();
    expect(
      within(reviewerActivityCard).getByText("참여 PR 5건"),
    ).toBeInTheDocument();

    const activeReviewerCard = findCardByTitle("적극 리뷰어 활동");
    expect(
      within(activeReviewerCard).getByText("reviewer1"),
    ).toBeInTheDocument();
    expect(within(activeReviewerCard).getByText("6건")).toBeInTheDocument();
    expect(
      within(activeReviewerCard).getByText("reviewer2"),
    ).toBeInTheDocument();
    expect(within(activeReviewerCard).getByText("4건")).toBeInTheDocument();

    const activeMainBranchCard = findCardByTitle("적극 메인 브랜치 기여");
    expect(
      within(activeMainBranchCard).getByText("maintainer2"),
    ).toBeInTheDocument();
    expect(within(activeMainBranchCard).getByText("5건")).toBeInTheDocument();
    expect(
      within(activeMainBranchCard).getByText("승인 리뷰 3건"),
    ).toBeInTheDocument();

    const mainBranchCard = findCardByTitle("메인 브랜치 기여");
    expect(within(mainBranchCard).getByText("maintainer1")).toBeInTheDocument();
    expect(within(mainBranchCard).getByText("7건")).toBeInTheDocument();
    expect(within(mainBranchCard).getByText("리뷰 5건")).toBeInTheDocument();
    expect(within(mainBranchCard).getByText(/\+120라인/)).toBeInTheDocument();
    expect(within(mainBranchCard).getByText(/-20라인/)).toBeInTheDocument();

    const fastestRespondersCard = findCardByTitle(
      "빠른 리뷰 응답",
      "5시간 30분",
    );
    expect(
      within(fastestRespondersCard).getByText("responder1"),
    ).toBeInTheDocument();
    expect(
      within(fastestRespondersCard).getByText("5시간 30분"),
    ).toBeInTheDocument();
    expect(
      within(fastestRespondersCard).getByText("응답 수 8건"),
    ).toBeInTheDocument();

    const issuesCreatedCard = findCardByTitle("이슈 생성", "18");
    expect(within(issuesCreatedCard).getByText("issuer1")).toBeInTheDocument();
    expect(within(issuesCreatedCard).getByText("18")).toBeInTheDocument();

    const prCreationCard = findCardByTitle("PR 생성", "15");
    expect(within(prCreationCard).getByText("creator1")).toBeInTheDocument();
    expect(within(prCreationCard).getByText("15")).toBeInTheDocument();

    const prMergedCard = findCardByTitle("PR 머지", "13");
    expect(within(prMergedCard).getByText("merger1")).toBeInTheDocument();
    expect(within(prMergedCard).getByText("13")).toBeInTheDocument();
    expect(within(prMergedCard).getByText(/\+180라인/)).toBeInTheDocument();
    expect(within(prMergedCard).getByText(/-40라인/)).toBeInTheDocument();

    const prMergedByCard = findCardByTitle("PR 머지 수행", "11");
    expect(within(prMergedByCard).getByText("executor1")).toBeInTheDocument();
    expect(within(prMergedByCard).getByText("11")).toBeInTheDocument();

    const prCompletenessCard = findCardByTitle("PR 완성도", /1\.2\s*건\/PR/);
    expect(
      within(prCompletenessCard).getByText("finisher1"),
    ).toBeInTheDocument();
    expect(
      within(prCompletenessCard).getByText(/1\.2\s*건\/PR/),
    ).toBeInTheDocument();
    expect(
      within(prCompletenessCard).getByText("PR 머지 10건"),
    ).toBeInTheDocument();

    const discussionCard = findCardByTitle("코멘트 참여", "9");
    expect(within(discussionCard).getByText("commenter1")).toBeInTheDocument();
    expect(within(discussionCard).getByText("9")).toBeInTheDocument();
  });
});
