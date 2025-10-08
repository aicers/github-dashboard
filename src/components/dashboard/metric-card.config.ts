import type {
  MetricFormat,
  MetricImpact,
} from "@/lib/dashboard/metric-formatters";
import type {
  IndividualMetricHistory,
  IndividualMetricSet,
  OrganizationAnalytics,
} from "@/lib/dashboard/types";

type IndividualTooltipKey =
  keyof typeof import("./metric-tooltips").individualMetricTooltips;
type OrganizationTooltipKey =
  keyof typeof import("./metric-tooltips").organizationMetricTooltips;

type IndividualMetricKey = keyof IndividualMetricSet;
type IndividualHistoryKey = keyof IndividualMetricHistory;
type OrganizationMetricKey = keyof OrganizationAnalytics["metrics"];
type OrganizationHistoryKey = keyof OrganizationAnalytics["metricHistory"];

type MetricCardConfig<
  TMetricKey extends string,
  THistoryKey extends string,
  TTooltipKey extends string,
> = {
  key: TMetricKey;
  historyKey: THistoryKey;
  title: string;
  format: MetricFormat;
  impact?: MetricImpact;
  tooltipKey: TTooltipKey;
};

export const INDIVIDUAL_METRIC_CARD_CONFIGS = [
  {
    key: "issuesCreated",
    historyKey: "issuesCreated",
    title: "이슈 생성",
    format: "count",
    tooltipKey: "issuesCreated",
  },
  {
    key: "issuesClosed",
    historyKey: "issuesClosed",
    title: "이슈 종료",
    format: "count",
    tooltipKey: "issuesClosed",
  },
  {
    key: "issueResolutionTime",
    historyKey: "issueResolutionTime",
    title: "평균 해결 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "issueResolutionTime",
  },
  {
    key: "issueWorkTime",
    historyKey: "issueWorkTime",
    title: "평균 작업 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "issueWorkTime",
  },
  {
    key: "prsCreated",
    historyKey: "prsCreated",
    title: "PR 생성",
    format: "count",
    tooltipKey: "prsCreated",
  },
  {
    key: "prsMerged",
    historyKey: "prsMerged",
    title: "PR 머지",
    format: "count",
    tooltipKey: "prsMerged",
  },
  {
    key: "prsMergedBy",
    historyKey: "prsMergedBy",
    title: "PR 머지 수행",
    format: "count",
    tooltipKey: "prsMergedBy",
  },
  {
    key: "prCompleteness",
    historyKey: "prCompleteness",
    title: "PR 완성도",
    format: "ratio",
    impact: "negative",
    tooltipKey: "prCompleteness",
  },
  {
    key: "reviewsCompleted",
    historyKey: "reviewsCompleted",
    title: "리뷰 수행",
    format: "count",
    tooltipKey: "reviewsCompleted",
  },
  {
    key: "activeReviewsCompleted",
    historyKey: "activeReviewsCompleted",
    title: "적극 리뷰 수행",
    format: "count",
    tooltipKey: "activeReviewsCompleted",
  },
  {
    key: "reviewResponseTime",
    historyKey: "reviewResponseTime",
    title: "리뷰 응답 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "reviewResponseTime",
  },
  {
    key: "reviewCoverage",
    historyKey: "reviewCoverage",
    title: "PR 리뷰 커버리지",
    format: "percentage",
    tooltipKey: "reviewCoverage",
  },
  {
    key: "reviewParticipation",
    historyKey: "reviewParticipation",
    title: "리뷰 참여 비율",
    format: "percentage",
    tooltipKey: "reviewParticipation",
  },
  {
    key: "discussionComments",
    historyKey: "discussionComments",
    title: "코멘트 참여",
    format: "count",
    tooltipKey: "discussionComments",
  },
] satisfies readonly MetricCardConfig<
  IndividualMetricKey,
  IndividualHistoryKey,
  IndividualTooltipKey
>[];

const PARENT_CHILD_KEYS = [
  "parentIssueResolutionTime",
  "parentIssueWorkTime",
  "childIssueResolutionTime",
  "childIssueWorkTime",
] as const;

type ParentChildMetricKey = (typeof PARENT_CHILD_KEYS)[number];

export const PARENT_CHILD_METRIC_CARD_CONFIGS = [
  {
    key: "parentIssueResolutionTime",
    historyKey: "parentIssueResolutionTime",
    title: "Parent 이슈 해결 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "parentIssueResolutionTime",
  },
  {
    key: "parentIssueWorkTime",
    historyKey: "parentIssueWorkTime",
    title: "Parent 이슈 작업 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "parentIssueWorkTime",
  },
  {
    key: "childIssueResolutionTime",
    historyKey: "childIssueResolutionTime",
    title: "Child 이슈 해결 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "childIssueResolutionTime",
  },
  {
    key: "childIssueWorkTime",
    historyKey: "childIssueWorkTime",
    title: "Child 이슈 작업 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "childIssueWorkTime",
  },
] satisfies readonly MetricCardConfig<
  ParentChildMetricKey,
  ParentChildMetricKey,
  ParentChildMetricKey
>[];

export const ORGANIZATION_METRIC_CARD_CONFIGS = [
  {
    key: "issuesCreated",
    historyKey: "issuesCreated",
    title: "이슈 생성",
    format: "count",
    tooltipKey: "issuesCreated",
  },
  {
    key: "issuesClosed",
    historyKey: "issuesClosed",
    title: "이슈 종료",
    format: "count",
    tooltipKey: "issuesClosed",
  },
  {
    key: "issueResolutionTime",
    historyKey: "issueResolutionTime",
    title: "평균 해결 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "issueResolutionTime",
  },
  {
    key: "issueWorkTime",
    historyKey: "issueWorkTime",
    title: "평균 작업 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "issueWorkTime",
  },
  {
    key: "prsCreated",
    historyKey: "prsCreated",
    title: "PR 생성",
    format: "count",
    tooltipKey: "prsCreated",
  },
  {
    key: "prsMerged",
    historyKey: "prsMerged",
    title: "PR 머지",
    format: "count",
    tooltipKey: "prsMerged",
  },
  {
    key: "avgCommentsPerPr",
    historyKey: "avgCommentsPerPr",
    title: "PR 평균 댓글",
    format: "ratio",
    tooltipKey: "avgCommentsPerPr",
  },
  {
    key: "avgReviewsPerPr",
    historyKey: "avgReviewsPerPr",
    title: "PR 평균 리뷰",
    format: "ratio",
    tooltipKey: "avgReviewsPerPr",
  },
  {
    key: "reviewParticipation",
    historyKey: "reviewParticipation",
    title: "리뷰 참여 비율",
    format: "percentage",
    tooltipKey: "reviewParticipation",
  },
  {
    key: "reviewResponseTime",
    historyKey: "reviewResponseTime",
    title: "리뷰 응답 시간",
    format: "hours",
    impact: "negative",
    tooltipKey: "reviewResponseTime",
  },
  {
    key: "mergeWithoutReviewRatio",
    historyKey: "mergeWithoutReviewRatio",
    title: "리뷰 없는 머지 비율",
    format: "percentage",
    tooltipKey: "mergeWithoutReviewRatio",
  },
  {
    key: "avgCommentsPerIssue",
    historyKey: "avgCommentsPerIssue",
    title: "해결된 이슈 평균 댓글",
    format: "ratio",
    tooltipKey: "avgCommentsPerIssue",
  },
] satisfies readonly MetricCardConfig<
  OrganizationMetricKey,
  OrganizationHistoryKey,
  OrganizationTooltipKey
>[];
