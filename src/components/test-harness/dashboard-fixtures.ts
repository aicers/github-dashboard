import type {
  ComparisonValue,
  DashboardAnalytics,
  DurationComparisonValue,
  IndividualAnalytics,
  LeaderboardDetail,
  LeaderboardEntry,
  LeaderboardSummary,
  MultiTrendPoint,
  RepoComparisonRow,
  RepoDistributionItem,
  ReviewerActivity,
} from "@/lib/dashboard/types";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

function createComparisonValue(
  current: number,
  previous = current,
  breakdown?: ComparisonValue["breakdown"],
): ComparisonValue {
  const absoluteChange = current - previous;
  const percentChange = previous === 0 ? null : absoluteChange / previous;
  return {
    current,
    previous,
    absoluteChange,
    percentChange,
    breakdown,
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

function createHistory(value: number): { period: "current"; value: number }[] {
  return [{ period: "current", value }];
}

function createLeaderboardEntry(
  user: UserProfile,
  value: number,
  details?: LeaderboardDetail[],
): LeaderboardEntry {
  return {
    user,
    value,
    details,
  };
}

const BASE_REPOSITORIES: RepositoryProfile[] = [
  {
    id: "repo-1",
    name: "Repo Alpha",
    nameWithOwner: "acme/repo-alpha",
  },
  {
    id: "repo-2",
    name: "Repo Beta",
    nameWithOwner: "acme/repo-beta",
  },
];

const BASE_CONTRIBUTORS: UserProfile[] = [
  {
    id: "user-1",
    login: "octoaide",
    name: "Octo Aide",
    avatarUrl: null,
  },
  {
    id: "user-2",
    login: "codecov",
    name: "Codecov Bot",
    avatarUrl: null,
  },
  {
    id: "user-3",
    login: "devkitty",
    name: "Dev Kitty",
    avatarUrl: null,
  },
];

const [REPO_ALPHA, REPO_BETA] = BASE_REPOSITORIES;
const [CONTRIB_OCTOAIDE, CONTRIB_CODECOV, CONTRIB_DEVKITTY] = BASE_CONTRIBUTORS;

const BASE_REPO_COMPARISON: RepoComparisonRow[] = [
  {
    repositoryId: REPO_ALPHA.id,
    repository: REPO_ALPHA,
    issuesCreated: 24,
    issuesResolved: 20,
    pullRequestsCreated: 18,
    pullRequestsMerged: 16,
    pullRequestsMergedBy: 14,
    reviews: 22,
    activeReviews: 12,
    comments: 30,
    avgFirstReviewHours: 10,
  },
  {
    repositoryId: REPO_BETA.id,
    repository: REPO_BETA,
    issuesCreated: 18,
    issuesResolved: 15,
    pullRequestsCreated: 12,
    pullRequestsMerged: 10,
    pullRequestsMergedBy: 9,
    reviews: 14,
    activeReviews: 7,
    comments: 18,
    avgFirstReviewHours: 14,
  },
];

const BASE_REPO_DISTRIBUTION: RepoDistributionItem[] = [
  {
    repositoryId: REPO_ALPHA.id,
    repository: REPO_ALPHA,
    totalEvents: 80,
    issues: 28,
    pullRequests: 22,
    reviews: 18,
    comments: 12,
    share: 0.6,
  },
  {
    repositoryId: REPO_BETA.id,
    repository: REPO_BETA,
    totalEvents: 54,
    issues: 18,
    pullRequests: 16,
    reviews: 12,
    comments: 8,
    share: 0.4,
  },
];

const BASE_REVIEWERS: ReviewerActivity[] = [
  {
    reviewerId: CONTRIB_CODECOV.id,
    reviewCount: 18,
    pullRequestsReviewed: 9,
    activeReviewCount: 6,
    profile: CONTRIB_CODECOV,
  },
  {
    reviewerId: CONTRIB_DEVKITTY.id,
    reviewCount: 12,
    pullRequestsReviewed: 6,
    activeReviewCount: 4,
    profile: CONTRIB_DEVKITTY,
  },
];

function buildIndividualAnalytics(
  person: UserProfile,
  multiplier: number,
): IndividualAnalytics {
  const value = (base: number) => base * multiplier;
  const comparison = (base: number) => createComparisonValue(value(base));
  const duration = (base: number) => createDurationValue(value(base));

  const metrics = {
    issuesCreated: comparison(3),
    issuesClosed: comparison(2.5),
    issueResolutionTime: duration(24),
    issueWorkTime: duration(18),
    parentIssueResolutionTime: duration(28),
    childIssueResolutionTime: duration(14),
    parentIssueWorkTime: duration(20),
    childIssueWorkTime: duration(12),
    prsCreated: comparison(4),
    prsMerged: comparison(3),
    prsMergedBy: comparison(2),
    prCompleteness: comparison(0.85),
    reviewsCompleted: comparison(5),
    activeReviewsCompleted: comparison(3),
    reviewResponseTime: duration(10),
    prsReviewed: comparison(4),
    reviewComments: comparison(8),
    reviewCoverage: comparison(0.6),
    reviewParticipation: comparison(0.5),
    reopenedIssues: comparison(0.5),
    discussionComments: comparison(6),
  } as IndividualAnalytics["metrics"];

  const metricHistory = Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      createHistory(value.current),
    ]),
  ) as IndividualAnalytics["metricHistory"];

  const reviewHeatmap = [
    { day: 1, hour: 9, count: value(1) },
    { day: 3, hour: 14, count: value(2) },
  ];

  const activityHeatmap = [
    { day: 2, hour: 10, count: value(1.5) },
    { day: 4, hour: 16, count: value(2.5) },
  ];

  const monthly: MultiTrendPoint[] = [
    { date: "2024-01-01", values: { issues: value(2), prs: value(1.5) } },
    { date: "2024-02-01", values: { issues: value(2.5), prs: value(1.8) } },
  ];

  return {
    person,
    metrics,
    metricHistory,
    trends: {
      monthly,
      repoActivity: BASE_REPO_DISTRIBUTION,
      reviewHeatmap,
      activityHeatmap,
    },
    repoComparison: BASE_REPO_COMPARISON,
  };
}

const BASE_LEADERBOARD: LeaderboardSummary = {
  prsCreated: [
    createLeaderboardEntry(CONTRIB_DEVKITTY, 14),
    createLeaderboardEntry(CONTRIB_CODECOV, 12),
  ],
  prsMerged: [
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 11),
    createLeaderboardEntry(CONTRIB_DEVKITTY, 9),
  ],
  prsMergedBy: [
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 6),
    createLeaderboardEntry(CONTRIB_CODECOV, 5),
  ],
  prCompleteness: [
    createLeaderboardEntry(CONTRIB_DEVKITTY, 0.94),
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 0.9),
  ],
  issuesCreated: [
    createLeaderboardEntry(CONTRIB_DEVKITTY, 18),
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 16),
  ],
  reviewsCompleted: [
    createLeaderboardEntry(CONTRIB_CODECOV, 20),
    createLeaderboardEntry(CONTRIB_DEVKITTY, 18),
  ],
  fastestResponders: [
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 6, [
      { label: "평균 응답", value: 6, suffix: "시간" },
    ]),
  ],
  discussionEngagement: [
    createLeaderboardEntry(CONTRIB_DEVKITTY, 24),
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 18),
  ],
  mainBranchContribution: [
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 120),
    createLeaderboardEntry(CONTRIB_DEVKITTY, 90),
  ],
  activeReviewerActivity: [
    createLeaderboardEntry(CONTRIB_CODECOV, 12),
    createLeaderboardEntry(CONTRIB_DEVKITTY, 8),
  ],
  activeMainBranchContribution: [
    createLeaderboardEntry(CONTRIB_OCTOAIDE, 60),
    createLeaderboardEntry(CONTRIB_CODECOV, 45),
  ],
};

export const DASHBOARD_FIXTURE_RANGE = {
  start: "2024-01-01T00:00:00.000Z",
  end: "2024-01-14T23:59:59.999Z",
} as const;

export function buildDashboardAnalyticsFixture(): DashboardAnalytics {
  const repositories = BASE_REPOSITORIES.map((repo) => ({ ...repo }));
  const contributors = BASE_CONTRIBUTORS.map((person) => ({ ...person }));
  const organization = {
    metrics: {
      issuesCreated: createComparisonValue(90, 80),
      issuesClosed: createComparisonValue(84, 78),
      issueResolutionTime: createDurationValue(32),
      issueWorkTime: createDurationValue(24),
      parentIssueResolutionTime: createDurationValue(36),
      childIssueResolutionTime: createDurationValue(18),
      parentIssueWorkTime: createDurationValue(28),
      childIssueWorkTime: createDurationValue(14),
      issueBacklogRatio: createComparisonValue(0.42, 0.38),
      prsCreated: createComparisonValue(70, 64),
      prsMerged: createComparisonValue(62, 58),
      prMergeTime: createDurationValue(20),
      mergeWithoutReviewRatio: createComparisonValue(0.08, 0.05),
      reviewsCompleted: createComparisonValue(88, 82),
      reviewResponseTime: createDurationValue(9),
      reviewParticipation: createComparisonValue(0.72, 0.68),
      avgPrSize: createComparisonValue(240, 220, [
        { label: "+ 합계", current: 280, previous: 260 },
        { label: "- 합계", current: 40, previous: 38 },
      ]),
      avgCommentsPerIssue: createComparisonValue(3.4, 3.1),
      avgCommentsPerPr: createComparisonValue(4.1, 3.8),
      avgReviewsPerPr: createComparisonValue(2.4, 2.1),
      totalEvents: createComparisonValue(310, 290),
    },
    activityBreakdown: {
      issues: 120,
      pullRequests: 110,
      reviews: 90,
      comments: 70,
    },
    metricHistory: {
      issuesCreated: createHistory(90),
      issuesClosed: createHistory(84),
      issueResolutionTime: createHistory(32),
      issueWorkTime: createHistory(24),
      parentIssueResolutionTime: createHistory(36),
      parentIssueWorkTime: createHistory(28),
      childIssueResolutionTime: createHistory(18),
      childIssueWorkTime: createHistory(14),
      prsCreated: createHistory(70),
      prsMerged: createHistory(62),
      avgPrAdditions: createHistory(280),
      avgPrNet: createHistory(240),
      avgCommentsPerPr: createHistory(4.1),
      avgReviewsPerPr: createHistory(2.4),
      mergeWithoutReviewRatio: createHistory(0.08),
      avgCommentsPerIssue: createHistory(3.4),
      reviewParticipation: createHistory(0.72),
      reviewResponseTime: createHistory(9),
    },
    reviewers: BASE_REVIEWERS,
    trends: {
      issuesCreated: [
        { date: "2024-01-01", value: 12 },
        { date: "2024-01-02", value: 14 },
      ],
      issuesClosed: [
        { date: "2024-01-01", value: 10 },
        { date: "2024-01-02", value: 11 },
      ],
      prsCreated: [
        { date: "2024-01-01", value: 8 },
        { date: "2024-01-02", value: 9 },
      ],
      prsMerged: [
        { date: "2024-01-01", value: 7 },
        { date: "2024-01-02", value: 8 },
      ],
      issueResolutionHours: [
        { date: "2024-01-01", values: { resolved: 30, opened: 12 } },
        { date: "2024-01-02", values: { resolved: 28, opened: 10 } },
      ],
      reviewHeatmap: [
        { day: 1, hour: 11, count: 6 },
        { day: 3, hour: 15, count: 8 },
      ],
    },
    repoDistribution: BASE_REPO_DISTRIBUTION,
    repoComparison: BASE_REPO_COMPARISON,
  };

  const defaultIndividualPerson = contributors[2] ?? contributors[0];
  const individual = buildIndividualAnalytics(defaultIndividualPerson, 1.2);

  return {
    range: {
      start: DASHBOARD_FIXTURE_RANGE.start,
      end: DASHBOARD_FIXTURE_RANGE.end,
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
    repositories,
    contributors,
    organization,
    individual,
    leaderboard: BASE_LEADERBOARD,
    timeZone: "UTC",
    weekStart: "monday",
  };
}

export function buildDashboardAnalyticsForPerson(
  personId: string,
): DashboardAnalytics {
  const base = buildDashboardAnalyticsFixture();
  const person = base.contributors.find(
    (contributor) => contributor.id === personId,
  );
  if (!person) {
    return base;
  }

  const multiplier =
    person.login === "octoaide" ? 1.5 : person.login === "codecov" ? 1.1 : 0.9;

  return {
    ...base,
    individual: buildIndividualAnalytics(person, multiplier),
  };
}
