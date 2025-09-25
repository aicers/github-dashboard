import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

export type ComparisonBreakdownEntry = {
  label: string;
  current: number;
  previous: number;
};

export type ComparisonValue = {
  current: number;
  previous: number;
  absoluteChange: number;
  percentChange: number | null;
  breakdown?: ComparisonBreakdownEntry[];
};

export type DurationComparisonValue = ComparisonValue & {
  unit: "hours" | "days";
};

export type RatioComparisonValue = ComparisonValue;

export type WeekStart = "sunday" | "monday";

export type TrendPoint = {
  date: string;
  value: number;
};

export type PeriodKey =
  | "previous4"
  | "previous3"
  | "previous2"
  | "previous"
  | "current";

export type MetricHistoryEntry = {
  period: PeriodKey;
  value: number | null;
};

export type MultiTrendPoint = {
  date: string;
  values: Record<string, number>;
};

export type HeatmapCell = {
  day: number;
  hour: number;
  count: number;
};

export type RepoDistributionItem = {
  repositoryId: string;
  repository: RepositoryProfile | null;
  totalEvents: number;
  issues: number;
  pullRequests: number;
  reviews: number;
  comments: number;
  share: number;
};

export type RepoComparisonRow = {
  repositoryId: string;
  repository: RepositoryProfile | null;
  issuesResolved: number;
  pullRequestsMerged: number;
  avgFirstReviewHours: number | null;
};

export type ReviewerActivity = {
  reviewerId: string;
  reviewCount: number;
  pullRequestsReviewed: number;
  profile: UserProfile | null;
};

export type OrganizationAnalytics = {
  metrics: {
    issuesCreated: ComparisonValue;
    issuesClosed: ComparisonValue;
    issueResolutionTime: DurationComparisonValue;
    issueWorkTime: DurationComparisonValue;
    parentIssueResolutionTime: DurationComparisonValue;
    childIssueResolutionTime: DurationComparisonValue;
    parentIssueWorkTime: DurationComparisonValue;
    childIssueWorkTime: DurationComparisonValue;
    issueBacklogRatio: RatioComparisonValue;
    prsCreated: ComparisonValue;
    prsMerged: ComparisonValue;
    prMergeTime: DurationComparisonValue;
    mergeWithoutReviewRatio: RatioComparisonValue;
    reviewsCompleted: ComparisonValue;
    reviewResponseTime: DurationComparisonValue;
    reviewParticipation: RatioComparisonValue;
    avgPrSize: ComparisonValue;
    avgCommentsPerIssue: ComparisonValue;
    avgCommentsPerPr: ComparisonValue;
    reopenedIssuesRatio: RatioComparisonValue;
    totalEvents: ComparisonValue;
  };
  activityBreakdown: {
    issues: number;
    pullRequests: number;
    reviews: number;
    comments: number;
  };
  metricHistory: {
    issuesCreated: MetricHistoryEntry[];
    issuesClosed: MetricHistoryEntry[];
    issueResolutionTime: MetricHistoryEntry[];
    issueWorkTime: MetricHistoryEntry[];
    parentIssueResolutionTime: MetricHistoryEntry[];
    parentIssueWorkTime: MetricHistoryEntry[];
    childIssueResolutionTime: MetricHistoryEntry[];
    childIssueWorkTime: MetricHistoryEntry[];
    prsCreated: MetricHistoryEntry[];
    prsMerged: MetricHistoryEntry[];
    reviewParticipation: MetricHistoryEntry[];
    reviewResponseTime: MetricHistoryEntry[];
  };
  reviewers: ReviewerActivity[];
  trends: {
    issuesCreated: TrendPoint[];
    issuesClosed: TrendPoint[];
    prsCreated: TrendPoint[];
    prsMerged: TrendPoint[];
    issueResolutionHours: MultiTrendPoint[];
    reviewHeatmap: HeatmapCell[];
  };
  repoDistribution: RepoDistributionItem[];
  repoComparison: RepoComparisonRow[];
};

export type IndividualMetricSet = {
  issuesCreated: ComparisonValue;
  issuesClosed: ComparisonValue;
  issueResolutionRatio: RatioComparisonValue;
  issueResolutionTime: DurationComparisonValue;
  issueWorkTime: DurationComparisonValue;
  parentIssueResolutionTime: DurationComparisonValue;
  childIssueResolutionTime: DurationComparisonValue;
  parentIssueWorkTime: DurationComparisonValue;
  childIssueWorkTime: DurationComparisonValue;
  prsCreated: ComparisonValue;
  prsMerged: ComparisonValue;
  reviewsCompleted: ComparisonValue;
  reviewResponseTime: DurationComparisonValue;
  prsReviewed: ComparisonValue;
  reviewComments: ComparisonValue;
  reviewCoverage: RatioComparisonValue;
  reviewParticipation: RatioComparisonValue;
  reopenedIssues: ComparisonValue;
  discussionComments: ComparisonValue;
};

export type IndividualTrends = {
  monthly: MultiTrendPoint[];
  repoActivity: RepoDistributionItem[];
};

export type IndividualAnalytics = {
  person: UserProfile;
  metrics: IndividualMetricSet;
  trends: IndividualTrends;
};

export type LeaderboardEntry = {
  user: UserProfile;
  value: number;
  secondaryValue?: number | null;
};

export type LeaderboardSummary = {
  prsCreated: LeaderboardEntry[];
  issuesCreated: LeaderboardEntry[];
  reviewsCompleted: LeaderboardEntry[];
  fastestResponders: LeaderboardEntry[];
  discussionEngagement: LeaderboardEntry[];
};

export type RangeSummary = {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  previous2Start: string;
  previous2End: string;
  previous3Start: string;
  previous3End: string;
  previous4Start: string;
  previous4End: string;
  intervalDays: number;
};

export type DashboardAnalytics = {
  range: RangeSummary;
  repositories: RepositoryProfile[];
  contributors: UserProfile[];
  organization: OrganizationAnalytics;
  individual: IndividualAnalytics | null;
  leaderboard: LeaderboardSummary;
  timeZone: string;
  weekStart: WeekStart;
};

export type AnalyticsParams = {
  start: string;
  end: string;
  repositoryIds?: string[];
  personId?: string | null;
};
