import {
  fetchActiveContributors,
  fetchMainBranchContribution,
  fetchReviewerActivity,
  type ReviewerActivityRow,
} from "@/lib/dashboard/analytics/engagement";
import { fetchTotalEvents, fetchTrend } from "@/lib/dashboard/analytics/events";
import {
  fetchIndividualActivityHeatmap,
  fetchIndividualCoverageMetrics,
  fetchIndividualDiscussion,
  fetchIndividualIssueMetrics,
  fetchIndividualMergedByMetrics,
  fetchIndividualMonthlyTrends,
  fetchIndividualPrCompletionMetrics,
  fetchIndividualPullRequestMetrics,
  fetchIndividualRepoActivity,
  fetchIndividualRepoComparison,
  fetchIndividualReviewHeatmap,
  fetchIndividualReviewMetrics,
  type IndividualPrCompletionRow,
} from "@/lib/dashboard/analytics/individual";
import {
  buildMonthlyDurationTrend,
  fetchIssueAggregates,
  fetchIssueDurationDetails,
  summarizeIssueDurations,
} from "@/lib/dashboard/analytics/issues";
import {
  fetchLeaderboard,
  fetchPrCompletionLeaderboard,
  type LeaderboardRow,
  type PrCompletionLeaderboardRow,
} from "@/lib/dashboard/analytics/leaderboards";
import { resolveProfiles } from "@/lib/dashboard/analytics/profiles";
import { fetchPrAggregates } from "@/lib/dashboard/analytics/pull-requests";
import {
  fetchRepoComparison,
  fetchRepoDistribution,
  type RepoComparisonRawRow,
  type RepoDistributionRow,
} from "@/lib/dashboard/analytics/repositories";
import {
  fetchReviewAggregates,
  fetchReviewHeatmap,
} from "@/lib/dashboard/analytics/reviews";
import {
  buildComparison,
  buildDurationComparison,
  buildHistorySeries,
  buildRatioComparison,
  normalizeText,
  resolveRange,
  roundToOneDecimal,
} from "@/lib/dashboard/analytics/shared";
import type {
  AnalyticsParams,
  DashboardAnalytics,
  IndividualMetricHistory,
  LeaderboardEntry,
  LeaderboardSummary,
  OrganizationAnalytics,
  RepoComparisonRow,
  RepoDistributionItem,
  ReviewerActivity,
  TrendPoint,
  WeekStart,
} from "@/lib/dashboard/types";
import { ensureSchema } from "@/lib/db";
import {
  getSyncConfig,
  getUserProfiles,
  listAllRepositories,
  listAllUsers,
  type RepositoryProfile,
  type UserProfile,
} from "@/lib/db/operations";
import { env } from "@/lib/env";

function mapRepoDistribution(
  rows: RepoDistributionRow[],
  repoProfiles: Map<string, RepositoryProfile>,
): RepoDistributionItem[] {
  const total = rows.reduce(
    (sum, row) => sum + Number(row.total_events ?? 0),
    0,
  );
  return rows.map((row) => ({
    repositoryId: row.repository_id,
    repository: repoProfiles.get(row.repository_id) ?? null,
    issues: Number(row.issues ?? 0),
    pullRequests: Number(row.pull_requests ?? 0),
    reviews: Number(row.reviews ?? 0),
    comments: Number(row.comments ?? 0),
    totalEvents: Number(row.total_events ?? 0),
    share: total > 0 ? Number(row.total_events ?? 0) / total : 0,
  }));
}

function mapRepoComparison(
  rows: RepoComparisonRawRow[],
  repoProfiles: Map<string, RepositoryProfile>,
): RepoComparisonRow[] {
  return rows.map((row) => ({
    repositoryId: row.repository_id,
    repository: repoProfiles.get(row.repository_id) ?? null,
    issuesCreated: Number(row.issues_created ?? 0),
    issuesResolved: Number(row.issues_resolved ?? 0),
    pullRequestsCreated: Number(row.prs_created ?? 0),
    pullRequestsMerged: Number(row.prs_merged ?? 0),
    pullRequestsMergedBy: Number(row.prs_merged_by ?? 0),
    reviews: Number(row.reviews ?? 0),
    activeReviews: Number(row.active_reviews ?? 0),
    comments: Number(row.comments ?? 0),
    avgFirstReviewHours: (() => {
      if (row.avg_first_review_hours == null) {
        return null;
      }

      const numeric = Number(row.avg_first_review_hours);
      return Number.isFinite(numeric) ? numeric : null;
    })(),
  }));
}

function mapReviewerActivity(
  rows: ReviewerActivityRow[],
  userProfiles: Map<string, UserProfile>,
): ReviewerActivity[] {
  return rows
    .filter((row) => row.reviewer_id)
    .map((row) => ({
      reviewerId: row.reviewer_id,
      reviewCount: Number(row.review_count ?? 0),
      pullRequestsReviewed: Number(row.prs_reviewed ?? 0),
      activeReviewCount: Number(row.active_review_count ?? 0),
      profile: userProfiles.get(row.reviewer_id) ?? null,
    }));
}

function mapLeaderboard(
  rows: LeaderboardRow[],
  userProfiles: Map<string, UserProfile>,
): LeaderboardEntry[] {
  return rows
    .filter((row) => row.user_id)
    .map((row) => {
      const additions = row.additions;
      const deletions = row.deletions;
      const hasLineDetails = additions != null || deletions != null;

      return {
        user: userProfiles.get(row.user_id) ?? {
          id: row.user_id,
          login: null,
          name: null,
          avatarUrl: null,
        },
        value: Number(row.value ?? 0),
        secondaryValue:
          row.secondary_value == null ? null : Number(row.secondary_value),
        ...(hasLineDetails
          ? {
              details: [
                {
                  label: "+",
                  value: Number(additions ?? 0),
                  sign: "positive" as const,
                  suffix: "라인",
                },
                {
                  label: "-",
                  value: Number(deletions ?? 0),
                  sign: "negative" as const,
                  suffix: "라인",
                },
              ],
            }
          : {}),
      } satisfies LeaderboardEntry;
    });
}

function mapPrCompletionLeaderboard(
  rows: PrCompletionLeaderboardRow[],
  userProfiles: Map<string, UserProfile>,
): LeaderboardEntry[] {
  return rows
    .filter((row) => row.user_id)
    .map((row) => {
      const user = userProfiles.get(row.user_id) ?? {
        id: row.user_id,
        login: null,
        name: null,
        avatarUrl: null,
      };

      return {
        user,
        value: (() => {
          const merged = Number(row.merged_prs ?? 0);
          if (merged === 0) {
            return 0;
          }
          const interactions =
            Number(row.commented_count ?? 0) +
            Number(row.changes_requested_count ?? 0);
          return interactions / merged;
        })(),
        secondaryValue: Number(row.merged_prs ?? 0),
        details: [
          {
            label: "COMMENTED",
            value: Number(row.commented_count ?? 0),
            suffix: "건",
          },
          {
            label: "CHANGES_REQUESTED",
            value: Number(row.changes_requested_count ?? 0),
            suffix: "건",
          },
        ],
      } satisfies LeaderboardEntry;
    });
}

function toTrend(points: TrendPoint[]): TrendPoint[] {
  return points.map((point) => ({
    date: point.date,
    value: Number(point.value ?? 0),
  }));
}

export async function getDashboardAnalytics(
  params: AnalyticsParams,
): Promise<DashboardAnalytics> {
  const { start, end, repositoryIds = [], personId } = params;
  const range = resolveRange({ start, end });

  await ensureSchema();
  const config = await getSyncConfig();
  const timeZone = config?.timezone ?? "UTC";
  const weekStart: WeekStart =
    config?.week_start === "sunday" ? "sunday" : "monday";
  const excludedUserIds = new Set<string>(
    Array.isArray(config?.excluded_user_ids)
      ? (config?.excluded_user_ids as string[]).filter(
          (id) => typeof id === "string" && id.trim().length > 0,
        )
      : [],
  );
  const excludedRepositoryIds = new Set<string>(
    Array.isArray(config?.excluded_repository_ids)
      ? (config?.excluded_repository_ids as string[]).filter(
          (id) => typeof id === "string" && id.trim().length > 0,
        )
      : [],
  );
  const availableRepositories = (await listAllRepositories()).filter(
    (repo) => !excludedRepositoryIds.has(repo.id),
  );
  const availableRepositoryIds = new Set(
    availableRepositories.map((repo) => repo.id),
  );
  const allowedRepositoryIds = repositoryIds.filter((id) =>
    availableRepositoryIds.has(id),
  );
  const shouldFilterByRepositories =
    allowedRepositoryIds.length > 0 &&
    allowedRepositoryIds.length < availableRepositoryIds.size;
  const repositoryFilter = shouldFilterByRepositories
    ? allowedRepositoryIds
    : undefined;
  const targetProject = normalizeText(env.TODO_PROJECT_NAME);
  const effectivePersonId =
    personId && !excludedUserIds.has(personId) ? personId : null;

  const [
    currentIssues,
    previousIssues,
    previous2Issues,
    previous3Issues,
    previous4Issues,
  ] = await Promise.all([
    fetchIssueAggregates(range.start, range.end, repositoryFilter),
    fetchIssueAggregates(
      range.previousStart,
      range.previousEnd,
      repositoryFilter,
    ),
    fetchIssueAggregates(
      range.previous2Start,
      range.previous2End,
      repositoryFilter,
    ),
    fetchIssueAggregates(
      range.previous3Start,
      range.previous3End,
      repositoryFilter,
    ),
    fetchIssueAggregates(
      range.previous4Start,
      range.previous4End,
      repositoryFilter,
    ),
  ]);

  const [currentPrs, previousPrs, previous2Prs, previous3Prs, previous4Prs] =
    await Promise.all([
      fetchPrAggregates(range.start, range.end, repositoryFilter),
      fetchPrAggregates(
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchPrAggregates(
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchPrAggregates(
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchPrAggregates(
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

  const [
    currentReviews,
    previousReviews,
    previous2Reviews,
    previous3Reviews,
    previous4Reviews,
  ] = await Promise.all([
    fetchReviewAggregates(range.start, range.end, repositoryFilter),
    fetchReviewAggregates(
      range.previousStart,
      range.previousEnd,
      repositoryFilter,
    ),
    fetchReviewAggregates(
      range.previous2Start,
      range.previous2End,
      repositoryFilter,
    ),
    fetchReviewAggregates(
      range.previous3Start,
      range.previous3End,
      repositoryFilter,
    ),
    fetchReviewAggregates(
      range.previous4Start,
      range.previous4End,
      repositoryFilter,
    ),
  ]);

  const [currentEvents, previousEvents] = await Promise.all([
    fetchTotalEvents(range.start, range.end, repositoryFilter),
    fetchTotalEvents(range.previousStart, range.previousEnd, repositoryFilter),
  ]);

  const [
    issuesCreatedTrend,
    issuesClosedTrend,
    prsCreatedTrend,
    prsMergedTrend,
    reviewHeatmap,
    repoDistributionRows,
    repoComparisonRows,
    reviewerActivityRows,
    mainBranchContributionRows,
    leaderboardPrs,
    leaderboardPrsMerged,
    leaderboardPrsMergedBy,
    leaderboardPrCompleteness,
    leaderboardIssues,
    leaderboardReviews,
    leaderboardResponders,
    leaderboardComments,
    currentIssueDurationDetails,
    previousIssueDurationDetails,
    previous2IssueDurationDetails,
    previous3IssueDurationDetails,
    previous4IssueDurationDetails,
  ] = await Promise.all([
    fetchTrend(
      "issues",
      "github_created_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchTrend(
      "issues",
      "github_closed_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchTrend(
      "pull_requests",
      "github_created_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchTrend(
      "pull_requests",
      "github_merged_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchReviewHeatmap(range.start, range.end, repositoryFilter, timeZone),
    fetchRepoDistribution(range.start, range.end, repositoryFilter),
    fetchRepoComparison(range.start, range.end, repositoryFilter),
    fetchReviewerActivity(range.start, range.end, repositoryFilter),
    fetchMainBranchContribution(range.start, range.end, repositoryFilter),
    fetchLeaderboard("prs", range.start, range.end, repositoryFilter),
    fetchLeaderboard("prsMerged", range.start, range.end, repositoryFilter),
    fetchLeaderboard("prsMergedBy", range.start, range.end, repositoryFilter),
    fetchPrCompletionLeaderboard(range.start, range.end, repositoryFilter),
    fetchLeaderboard("issues", range.start, range.end, repositoryFilter),
    fetchLeaderboard("reviews", range.start, range.end, repositoryFilter),
    fetchLeaderboard("response", range.start, range.end, repositoryFilter),
    fetchLeaderboard("comments", range.start, range.end, repositoryFilter),
    fetchIssueDurationDetails(range.start, range.end, repositoryFilter),
    fetchIssueDurationDetails(
      range.previousStart,
      range.previousEnd,
      repositoryFilter,
    ),
    fetchIssueDurationDetails(
      range.previous2Start,
      range.previous2End,
      repositoryFilter,
    ),
    fetchIssueDurationDetails(
      range.previous3Start,
      range.previous3End,
      repositoryFilter,
    ),
    fetchIssueDurationDetails(
      range.previous4Start,
      range.previous4End,
      repositoryFilter,
    ),
  ]);

  const filterExcludedRepo = <T extends { repository_id: string }>(rows: T[]) =>
    rows.filter((row) => !excludedRepositoryIds.has(row.repository_id));

  const filteredRepoDistributionRows = filterExcludedRepo(repoDistributionRows);
  const filteredRepoComparisonRows = filterExcludedRepo(repoComparisonRows);

  const filterByUser = <T>(
    rows: T[],
    getId: (row: T) => string | null | undefined,
  ) =>
    rows.filter((row) => {
      const id = getId(row);
      return !id || !excludedUserIds.has(id);
    });

  const reviewerActivityVisibleRows = filterByUser(
    reviewerActivityRows,
    (row) => row.reviewer_id,
  );
  const mainBranchContributionVisibleRows = filterByUser(
    mainBranchContributionRows,
    (row) => row.user_id,
  );
  const leaderboardPrsVisible = filterByUser(
    leaderboardPrs,
    (row) => row.user_id,
  );
  const leaderboardPrsMergedVisible = filterByUser(
    leaderboardPrsMerged,
    (row) => row.user_id,
  );
  const leaderboardPrsMergedByVisible = filterByUser(
    leaderboardPrsMergedBy,
    (row) => row.user_id,
  );
  const leaderboardPrCompletenessVisible = filterByUser(
    leaderboardPrCompleteness,
    (row) => row.user_id,
  );
  const leaderboardIssuesVisible = filterByUser(
    leaderboardIssues,
    (row) => row.user_id,
  );
  const leaderboardReviewsVisible = filterByUser(
    leaderboardReviews,
    (row) => row.user_id,
  );
  const leaderboardRespondersVisible = filterByUser(
    leaderboardResponders,
    (row) => row.user_id,
  );
  const leaderboardCommentsVisible = filterByUser(
    leaderboardComments,
    (row) => row.user_id,
  );

  const repoIds = new Set<string>();
  filteredRepoDistributionRows.forEach((row) => {
    repoIds.add(row.repository_id);
  });
  filteredRepoComparisonRows.forEach((row) => {
    repoIds.add(row.repository_id);
  });

  const reviewerIds = new Set<string>();
  reviewerActivityVisibleRows.forEach((row) => {
    if (row.reviewer_id) {
      reviewerIds.add(row.reviewer_id);
    }
  });

  const leaderboardUserIds = new Set<string>();
  [
    leaderboardPrsVisible,
    leaderboardPrsMergedVisible,
    leaderboardPrsMergedByVisible,
    leaderboardPrCompletenessVisible,
    leaderboardIssuesVisible,
    leaderboardReviewsVisible,
    leaderboardRespondersVisible,
    leaderboardCommentsVisible,
  ].forEach((rows) => {
    rows.forEach((row) => {
      if (row.user_id) {
        leaderboardUserIds.add(row.user_id);
      }
    });
  });

  const contributorIds = (
    await fetchActiveContributors(range.start, range.end, repositoryFilter)
  ).filter((id) => !excludedUserIds.has(id));
  contributorIds.forEach((id) => {
    leaderboardUserIds.add(id);
  });

  let personProfile: UserProfile | null = null;
  if (effectivePersonId) {
    leaderboardUserIds.add(effectivePersonId);
  }

  const { users } = await resolveProfiles(
    Array.from(repoIds),
    Array.from(new Set([...reviewerIds, ...leaderboardUserIds])),
  );
  const filteredRepositories = availableRepositories;
  const repoProfileMap = new Map(
    filteredRepositories.map((repo) => [repo.id, repo]),
  );
  const userProfileMap = new Map(users.map((user) => [user.id, user]));

  if (effectivePersonId) {
    personProfile = userProfileMap.get(effectivePersonId) ?? null;
    if (!personProfile) {
      const profiles = await getUserProfiles([effectivePersonId]);
      if (profiles.length) {
        personProfile = profiles[0];
        userProfileMap.set(personProfile.id, personProfile);
      }
    }
  }

  const issueDurationCurrent = summarizeIssueDurations(
    currentIssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious = summarizeIssueDurations(
    previousIssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious2 = summarizeIssueDurations(
    previous2IssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious3 = summarizeIssueDurations(
    previous3IssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious4 = summarizeIssueDurations(
    previous4IssueDurationDetails,
    targetProject,
  );
  const monthlyDurationTrend = buildMonthlyDurationTrend(
    currentIssueDurationDetails,
    targetProject,
    timeZone,
  );

  const issueMetrics = {
    issuesCreated: buildComparison(
      currentIssues.issues_created,
      previousIssues.issues_created,
    ),
    issuesClosed: buildComparison(
      currentIssues.issues_closed,
      previousIssues.issues_closed,
    ),
    issueResolutionTime: buildDurationComparison(
      currentIssues.avg_resolution_hours,
      previousIssues.avg_resolution_hours,
      "hours",
    ),
    issueWorkTime: buildDurationComparison(
      issueDurationCurrent.overallWork,
      issueDurationPrevious.overallWork,
      "hours",
    ),
    issueBacklogRatio: buildRatioComparison(
      currentIssues.issues_closed
        ? currentIssues.issues_created / currentIssues.issues_closed
        : currentIssues.issues_created,
      previousIssues.issues_closed
        ? previousIssues.issues_created / previousIssues.issues_closed
        : previousIssues.issues_created,
    ),
    parentIssueResolutionTime: buildDurationComparison(
      issueDurationCurrent.parentResolution,
      issueDurationPrevious.parentResolution,
      "hours",
    ),
    childIssueResolutionTime: buildDurationComparison(
      issueDurationCurrent.childResolution,
      issueDurationPrevious.childResolution,
      "hours",
    ),
    parentIssueWorkTime: buildDurationComparison(
      issueDurationCurrent.parentWork,
      issueDurationPrevious.parentWork,
      "hours",
    ),
    childIssueWorkTime: buildDurationComparison(
      issueDurationCurrent.childWork,
      issueDurationPrevious.childWork,
      "hours",
    ),
  };

  const organizationHistory = {
    issuesCreated: buildHistorySeries([
      previous4Issues.issues_created,
      previous3Issues.issues_created,
      previous2Issues.issues_created,
      previousIssues.issues_created,
      currentIssues.issues_created,
    ]),
    issuesClosed: buildHistorySeries([
      previous4Issues.issues_closed,
      previous3Issues.issues_closed,
      previous2Issues.issues_closed,
      previousIssues.issues_closed,
      currentIssues.issues_closed,
    ]),
    issueResolutionTime: buildHistorySeries([
      previous4Issues.avg_resolution_hours,
      previous3Issues.avg_resolution_hours,
      previous2Issues.avg_resolution_hours,
      previousIssues.avg_resolution_hours,
      currentIssues.avg_resolution_hours,
    ]),
    issueWorkTime: buildHistorySeries([
      issueDurationPrevious4.overallWork,
      issueDurationPrevious3.overallWork,
      issueDurationPrevious2.overallWork,
      issueDurationPrevious.overallWork,
      issueDurationCurrent.overallWork,
    ]),
    parentIssueResolutionTime: buildHistorySeries([
      issueDurationPrevious4.parentResolution,
      issueDurationPrevious3.parentResolution,
      issueDurationPrevious2.parentResolution,
      issueDurationPrevious.parentResolution,
      issueDurationCurrent.parentResolution,
    ]),
    parentIssueWorkTime: buildHistorySeries([
      issueDurationPrevious4.parentWork,
      issueDurationPrevious3.parentWork,
      issueDurationPrevious2.parentWork,
      issueDurationPrevious.parentWork,
      issueDurationCurrent.parentWork,
    ]),
    childIssueResolutionTime: buildHistorySeries([
      issueDurationPrevious4.childResolution,
      issueDurationPrevious3.childResolution,
      issueDurationPrevious2.childResolution,
      issueDurationPrevious.childResolution,
      issueDurationCurrent.childResolution,
    ]),
    childIssueWorkTime: buildHistorySeries([
      issueDurationPrevious4.childWork,
      issueDurationPrevious3.childWork,
      issueDurationPrevious2.childWork,
      issueDurationPrevious.childWork,
      issueDurationCurrent.childWork,
    ]),
    prsCreated: buildHistorySeries([
      previous4Prs.prs_created,
      previous3Prs.prs_created,
      previous2Prs.prs_created,
      previousPrs.prs_created,
      currentPrs.prs_created,
    ]),
    prsMerged: buildHistorySeries([
      previous4Prs.prs_merged,
      previous3Prs.prs_merged,
      previous2Prs.prs_merged,
      previousPrs.prs_merged,
      currentPrs.prs_merged,
    ]),
    avgPrAdditions: buildHistorySeries([
      roundToOneDecimal(previous4Prs.avg_additions),
      roundToOneDecimal(previous3Prs.avg_additions),
      roundToOneDecimal(previous2Prs.avg_additions),
      roundToOneDecimal(previousPrs.avg_additions),
      roundToOneDecimal(currentPrs.avg_additions),
    ]),
    avgPrNet: buildHistorySeries([
      roundToOneDecimal(
        Number(previous4Prs.avg_additions ?? 0) -
          Number(previous4Prs.avg_deletions ?? 0),
      ),
      roundToOneDecimal(
        Number(previous3Prs.avg_additions ?? 0) -
          Number(previous3Prs.avg_deletions ?? 0),
      ),
      roundToOneDecimal(
        Number(previous2Prs.avg_additions ?? 0) -
          Number(previous2Prs.avg_deletions ?? 0),
      ),
      roundToOneDecimal(
        Number(previousPrs.avg_additions ?? 0) -
          Number(previousPrs.avg_deletions ?? 0),
      ),
      roundToOneDecimal(
        Number(currentPrs.avg_additions ?? 0) -
          Number(currentPrs.avg_deletions ?? 0),
      ),
    ]),
    avgCommentsPerPr: buildHistorySeries([
      Number(previous4Prs.avg_comments_pr ?? 0),
      Number(previous3Prs.avg_comments_pr ?? 0),
      Number(previous2Prs.avg_comments_pr ?? 0),
      Number(previousPrs.avg_comments_pr ?? 0),
      Number(currentPrs.avg_comments_pr ?? 0),
    ]),
    avgReviewsPerPr: buildHistorySeries([
      Number(previous4Prs.avg_reviews_pr ?? 0),
      Number(previous3Prs.avg_reviews_pr ?? 0),
      Number(previous2Prs.avg_reviews_pr ?? 0),
      Number(previousPrs.avg_reviews_pr ?? 0),
      Number(currentPrs.avg_reviews_pr ?? 0),
    ]),
    mergeWithoutReviewRatio: buildHistorySeries([
      previous4Prs.prs_merged
        ? previous4Prs.merge_without_review / previous4Prs.prs_merged
        : 0,
      previous3Prs.prs_merged
        ? previous3Prs.merge_without_review / previous3Prs.prs_merged
        : 0,
      previous2Prs.prs_merged
        ? previous2Prs.merge_without_review / previous2Prs.prs_merged
        : 0,
      previousPrs.prs_merged
        ? previousPrs.merge_without_review / previousPrs.prs_merged
        : 0,
      currentPrs.prs_merged
        ? currentPrs.merge_without_review / currentPrs.prs_merged
        : 0,
    ]),
    avgCommentsPerIssue: buildHistorySeries([
      Number(previous4Issues.avg_comments_issue ?? 0),
      Number(previous3Issues.avg_comments_issue ?? 0),
      Number(previous2Issues.avg_comments_issue ?? 0),
      Number(previousIssues.avg_comments_issue ?? 0),
      Number(currentIssues.avg_comments_issue ?? 0),
    ]),
    reviewParticipation: buildHistorySeries([
      previous4Reviews.avg_participation,
      previous3Reviews.avg_participation,
      previous2Reviews.avg_participation,
      previousReviews.avg_participation,
      currentReviews.avg_participation,
    ]),
    reviewResponseTime: buildHistorySeries([
      previous4Reviews.avg_response_hours,
      previous3Reviews.avg_response_hours,
      previous2Reviews.avg_response_hours,
      previousReviews.avg_response_hours,
      currentReviews.avg_response_hours,
    ]),
  } satisfies OrganizationAnalytics["metricHistory"];

  const prMetrics = {
    prsCreated: buildComparison(
      currentPrs.prs_created,
      previousPrs.prs_created,
      [
        {
          label: "Dependabot",
          current: currentPrs.prs_created_dependabot,
          previous: previousPrs.prs_created_dependabot,
        },
      ],
    ),
    prsMerged: buildComparison(currentPrs.prs_merged, previousPrs.prs_merged, [
      {
        label: "Dependabot",
        current: currentPrs.prs_merged_dependabot,
        previous: previousPrs.prs_merged_dependabot,
      },
    ]),
    prMergeTime: buildDurationComparison(
      currentPrs.avg_merge_hours,
      previousPrs.avg_merge_hours,
      "hours",
    ),
    mergeWithoutReviewRatio: buildRatioComparison(
      currentPrs.prs_merged
        ? currentPrs.merge_without_review / currentPrs.prs_merged
        : 0,
      previousPrs.prs_merged
        ? previousPrs.merge_without_review / previousPrs.prs_merged
        : 0,
    ),
    avgPrSize: (() => {
      const currentTotal = roundToOneDecimal(currentPrs.avg_lines_changed);
      const previousTotal = roundToOneDecimal(previousPrs.avg_lines_changed);
      const currentAdditions = roundToOneDecimal(currentPrs.avg_additions);
      const previousAdditions = roundToOneDecimal(previousPrs.avg_additions);
      const currentDeletions = roundToOneDecimal(currentPrs.avg_deletions);
      const previousDeletions = roundToOneDecimal(previousPrs.avg_deletions);

      const comparison = buildComparison(currentTotal, previousTotal);
      comparison.breakdown = [
        {
          key: "additions",
          label: "+ 합계",
          current: currentAdditions,
          previous: previousAdditions,
        },
        {
          key: "deletions",
          label: "- 합계",
          current: currentDeletions,
          previous: previousDeletions,
        },
      ];
      return comparison;
    })(),
    avgCommentsPerPr: buildComparison(
      Number(currentPrs.avg_comments_pr ?? 0),
      Number(previousPrs.avg_comments_pr ?? 0),
    ),
    avgReviewsPerPr: buildComparison(
      Number(currentPrs.avg_reviews_pr ?? 0),
      Number(previousPrs.avg_reviews_pr ?? 0),
    ),
  };

  const reviewMetrics = {
    reviewsCompleted: buildComparison(
      currentReviews.reviews_completed,
      previousReviews.reviews_completed,
    ),
    reviewResponseTime: buildDurationComparison(
      currentReviews.avg_response_hours,
      previousReviews.avg_response_hours,
      "hours",
    ),
    reviewParticipation: buildRatioComparison(
      currentReviews.avg_participation,
      previousReviews.avg_participation,
    ),
  };

  const collaborationMetrics = {
    avgCommentsPerIssue: buildComparison(
      Number(currentIssues.avg_comments_issue ?? 0),
      Number(previousIssues.avg_comments_issue ?? 0),
    ),
  };

  const activityMetrics = {
    totalEvents: buildComparison(
      currentEvents.total_events,
      previousEvents.total_events,
    ),
  };

  const activityBreakdown = {
    issues: Number(currentEvents.issues ?? 0),
    pullRequests: Number(currentEvents.pull_requests ?? 0),
    reviews: Number(currentEvents.reviews ?? 0),
    comments: Number(currentEvents.comments ?? 0),
  };

  const organization: OrganizationAnalytics = {
    metrics: {
      ...issueMetrics,
      ...prMetrics,
      ...reviewMetrics,
      ...collaborationMetrics,
      totalEvents: activityMetrics.totalEvents,
    },
    activityBreakdown,
    metricHistory: organizationHistory,
    reviewers: mapReviewerActivity(reviewerActivityVisibleRows, userProfileMap),
    trends: {
      issuesCreated: toTrend(issuesCreatedTrend),
      issuesClosed: toTrend(issuesClosedTrend),
      prsCreated: toTrend(prsCreatedTrend),
      prsMerged: toTrend(prsMergedTrend),
      issueResolutionHours: monthlyDurationTrend,
      reviewHeatmap,
    },
    repoDistribution: mapRepoDistribution(
      filteredRepoDistributionRows,
      repoProfileMap,
    ),
    repoComparison: mapRepoComparison(
      filteredRepoComparisonRows,
      repoProfileMap,
    ),
  };

  let individual = null;
  if (personProfile) {
    const [
      individualIssuesCurrent,
      individualIssuesPrevious,
      individualIssuesPrevious2,
      individualIssuesPrevious3,
      individualIssuesPrevious4,
    ] = await Promise.all([
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualPullRequestsCurrent,
      individualPullRequestsPrevious,
      individualPullRequestsPrevious2,
      individualPullRequestsPrevious3,
      individualPullRequestsPrevious4,
    ] = await Promise.all([
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualMergedByCurrent,
      individualMergedByPrevious,
      individualMergedByPrevious2,
      individualMergedByPrevious3,
      individualMergedByPrevious4,
    ] = await Promise.all([
      fetchIndividualMergedByMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualMergedByMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualMergedByMetrics(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualMergedByMetrics(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualMergedByMetrics(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualPrCompletionCurrent,
      individualPrCompletionPrevious,
      individualPrCompletionPrevious2,
      individualPrCompletionPrevious3,
      individualPrCompletionPrevious4,
    ] = await Promise.all([
      fetchIndividualPrCompletionMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualPrCompletionMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualPrCompletionMetrics(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualPrCompletionMetrics(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualPrCompletionMetrics(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualReviewsCurrent,
      individualReviewsPrevious,
      individualReviewsPrevious2,
      individualReviewsPrevious3,
      individualReviewsPrevious4,
    ] = await Promise.all([
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualCoverageCurrent,
      individualCoveragePrevious,
      individualCoveragePrevious2,
      individualCoveragePrevious3,
      individualCoveragePrevious4,
    ] = await Promise.all([
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualDiscussionCurrent,
      individualDiscussionPrevious,
      individualDiscussionPrevious2,
      individualDiscussionPrevious3,
      individualDiscussionPrevious4,
    ] = await Promise.all([
      fetchIndividualDiscussion(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualDiscussion(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualDiscussion(
        personProfile.id,
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchIndividualDiscussion(
        personProfile.id,
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchIndividualDiscussion(
        personProfile.id,
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

    const [
      individualIssueDurationsCurrent,
      individualIssueDurationsPrevious,
      individualIssueDurationsPrevious2,
      individualIssueDurationsPrevious3,
      individualIssueDurationsPrevious4,
    ] = await Promise.all([
      fetchIssueDurationDetails(
        range.start,
        range.end,
        repositoryFilter,
        personProfile.id,
      ),
      fetchIssueDurationDetails(
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
        personProfile.id,
      ),
      fetchIssueDurationDetails(
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
        personProfile.id,
      ),
      fetchIssueDurationDetails(
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
        personProfile.id,
      ),
      fetchIssueDurationDetails(
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
        personProfile.id,
      ),
    ]);

    const [
      individualMonthly,
      individualRepoRows,
      individualRepoComparisonRows,
      individualReviewHeatmap,
      individualActivityHeatmap,
    ] = await Promise.all([
      fetchIndividualMonthlyTrends(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
        timeZone,
      ),
      fetchIndividualRepoActivity(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualRepoComparison(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualReviewHeatmap(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
        timeZone,
      ),
      fetchIndividualActivityHeatmap(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
        timeZone,
      ),
    ]);

    const filteredIndividualRepoRows = filterExcludedRepo(individualRepoRows);
    const filteredIndividualRepoComparisonRows = filterExcludedRepo(
      individualRepoComparisonRows,
    );

    const individualDurationCurrent = summarizeIssueDurations(
      individualIssueDurationsCurrent,
      targetProject,
    );
    const individualDurationPrevious = summarizeIssueDurations(
      individualIssueDurationsPrevious,
      targetProject,
    );
    const individualDurationPrevious2 = summarizeIssueDurations(
      individualIssueDurationsPrevious2,
      targetProject,
    );
    const individualDurationPrevious3 = summarizeIssueDurations(
      individualIssueDurationsPrevious3,
      targetProject,
    );
    const individualDurationPrevious4 = summarizeIssueDurations(
      individualIssueDurationsPrevious4,
      targetProject,
    );

    const calculatePrCompletenessValue = (row: IndividualPrCompletionRow) => {
      if (!row || row.merged_prs <= 0) {
        return 0;
      }
      const totalFeedback =
        Number(row.commented_count ?? 0) +
        Number(row.changes_requested_count ?? 0);
      return totalFeedback / row.merged_prs;
    };

    const individualMetrics = {
      issuesCreated: buildComparison(
        individualIssuesCurrent.created,
        individualIssuesPrevious.created,
      ),
      issuesClosed: buildComparison(
        individualIssuesCurrent.closed,
        individualIssuesPrevious.closed,
      ),
      issueResolutionTime: buildDurationComparison(
        individualIssuesCurrent.avg_resolution_hours,
        individualIssuesPrevious.avg_resolution_hours,
        "hours",
      ),
      issueWorkTime: buildDurationComparison(
        individualDurationCurrent.overallWork,
        individualDurationPrevious.overallWork,
        "hours",
      ),
      prsCreated: buildComparison(
        individualPullRequestsCurrent.created,
        individualPullRequestsPrevious.created,
      ),
      prsMerged: buildComparison(
        individualPullRequestsCurrent.merged,
        individualPullRequestsPrevious.merged,
      ),
      prsMergedBy: buildComparison(
        individualMergedByCurrent.merged,
        individualMergedByPrevious.merged,
      ),
      prCompleteness: buildComparison(
        calculatePrCompletenessValue(individualPrCompletionCurrent),
        calculatePrCompletenessValue(individualPrCompletionPrevious),
        [
          {
            label: "PR 머지",
            current: Number(individualPrCompletionCurrent.merged_prs ?? 0),
            previous: Number(individualPrCompletionPrevious.merged_prs ?? 0),
          },
          {
            label: "COMMENTED",
            current: Number(individualPrCompletionCurrent.commented_count ?? 0),
            previous: Number(
              individualPrCompletionPrevious.commented_count ?? 0,
            ),
          },
          {
            label: "CHANGES_REQUESTED",
            current: Number(
              individualPrCompletionCurrent.changes_requested_count ?? 0,
            ),
            previous: Number(
              individualPrCompletionPrevious.changes_requested_count ?? 0,
            ),
          },
        ],
      ),
      parentIssueResolutionTime: buildDurationComparison(
        individualDurationCurrent.parentResolution,
        individualDurationPrevious.parentResolution,
        "hours",
      ),
      childIssueResolutionTime: buildDurationComparison(
        individualDurationCurrent.childResolution,
        individualDurationPrevious.childResolution,
        "hours",
      ),
      parentIssueWorkTime: buildDurationComparison(
        individualDurationCurrent.parentWork,
        individualDurationPrevious.parentWork,
        "hours",
      ),
      childIssueWorkTime: buildDurationComparison(
        individualDurationCurrent.childWork,
        individualDurationPrevious.childWork,
        "hours",
      ),
      reviewsCompleted: buildComparison(
        individualReviewsCurrent.reviews,
        individualReviewsPrevious.reviews,
      ),
      activeReviewsCompleted: buildComparison(
        individualReviewsCurrent.active_reviews,
        individualReviewsPrevious.active_reviews,
      ),
      reviewResponseTime: buildDurationComparison(
        individualReviewsCurrent.avg_response_hours,
        individualReviewsPrevious.avg_response_hours,
        "hours",
      ),
      prsReviewed: buildComparison(
        individualReviewsCurrent.prs_reviewed,
        individualReviewsPrevious.prs_reviewed,
      ),
      reviewComments: buildComparison(
        individualReviewsCurrent.review_comments,
        individualReviewsPrevious.review_comments,
      ),
      reviewCoverage: buildRatioComparison(
        individualCoverageCurrent.coverage,
        individualCoveragePrevious.coverage,
      ),
      reviewParticipation: buildRatioComparison(
        individualCoverageCurrent.participation,
        individualCoveragePrevious.participation,
      ),
      reopenedIssues: buildComparison(
        individualIssuesCurrent.reopened,
        individualIssuesPrevious.reopened,
      ),
      discussionComments: buildComparison(
        individualDiscussionCurrent.comments,
        individualDiscussionPrevious.comments,
      ),
    };

    const individualHistory = {
      issuesCreated: buildHistorySeries([
        individualIssuesPrevious4.created,
        individualIssuesPrevious3.created,
        individualIssuesPrevious2.created,
        individualIssuesPrevious.created,
        individualIssuesCurrent.created,
      ]),
      issuesClosed: buildHistorySeries([
        individualIssuesPrevious4.closed,
        individualIssuesPrevious3.closed,
        individualIssuesPrevious2.closed,
        individualIssuesPrevious.closed,
        individualIssuesCurrent.closed,
      ]),
      issueResolutionTime: buildHistorySeries([
        individualIssuesPrevious4.avg_resolution_hours,
        individualIssuesPrevious3.avg_resolution_hours,
        individualIssuesPrevious2.avg_resolution_hours,
        individualIssuesPrevious.avg_resolution_hours,
        individualIssuesCurrent.avg_resolution_hours,
      ]),
      issueWorkTime: buildHistorySeries([
        individualDurationPrevious4.overallWork,
        individualDurationPrevious3.overallWork,
        individualDurationPrevious2.overallWork,
        individualDurationPrevious.overallWork,
        individualDurationCurrent.overallWork,
      ]),
      parentIssueResolutionTime: buildHistorySeries([
        individualDurationPrevious4.parentResolution,
        individualDurationPrevious3.parentResolution,
        individualDurationPrevious2.parentResolution,
        individualDurationPrevious.parentResolution,
        individualDurationCurrent.parentResolution,
      ]),
      parentIssueWorkTime: buildHistorySeries([
        individualDurationPrevious4.parentWork,
        individualDurationPrevious3.parentWork,
        individualDurationPrevious2.parentWork,
        individualDurationPrevious.parentWork,
        individualDurationCurrent.parentWork,
      ]),
      childIssueResolutionTime: buildHistorySeries([
        individualDurationPrevious4.childResolution,
        individualDurationPrevious3.childResolution,
        individualDurationPrevious2.childResolution,
        individualDurationPrevious.childResolution,
        individualDurationCurrent.childResolution,
      ]),
      childIssueWorkTime: buildHistorySeries([
        individualDurationPrevious4.childWork,
        individualDurationPrevious3.childWork,
        individualDurationPrevious2.childWork,
        individualDurationPrevious.childWork,
        individualDurationCurrent.childWork,
      ]),
      prsCreated: buildHistorySeries([
        individualPullRequestsPrevious4.created,
        individualPullRequestsPrevious3.created,
        individualPullRequestsPrevious2.created,
        individualPullRequestsPrevious.created,
        individualPullRequestsCurrent.created,
      ]),
      prsMerged: buildHistorySeries([
        individualPullRequestsPrevious4.merged,
        individualPullRequestsPrevious3.merged,
        individualPullRequestsPrevious2.merged,
        individualPullRequestsPrevious.merged,
        individualPullRequestsCurrent.merged,
      ]),
      prsMergedBy: buildHistorySeries([
        individualMergedByPrevious4.merged,
        individualMergedByPrevious3.merged,
        individualMergedByPrevious2.merged,
        individualMergedByPrevious.merged,
        individualMergedByCurrent.merged,
      ]),
      prCompleteness: buildHistorySeries([
        calculatePrCompletenessValue(individualPrCompletionPrevious4),
        calculatePrCompletenessValue(individualPrCompletionPrevious3),
        calculatePrCompletenessValue(individualPrCompletionPrevious2),
        calculatePrCompletenessValue(individualPrCompletionPrevious),
        calculatePrCompletenessValue(individualPrCompletionCurrent),
      ]),
      reviewsCompleted: buildHistorySeries([
        individualReviewsPrevious4.reviews,
        individualReviewsPrevious3.reviews,
        individualReviewsPrevious2.reviews,
        individualReviewsPrevious.reviews,
        individualReviewsCurrent.reviews,
      ]),
      activeReviewsCompleted: buildHistorySeries([
        individualReviewsPrevious4.active_reviews,
        individualReviewsPrevious3.active_reviews,
        individualReviewsPrevious2.active_reviews,
        individualReviewsPrevious.active_reviews,
        individualReviewsCurrent.active_reviews,
      ]),
      reviewResponseTime: buildHistorySeries([
        individualReviewsPrevious4.avg_response_hours,
        individualReviewsPrevious3.avg_response_hours,
        individualReviewsPrevious2.avg_response_hours,
        individualReviewsPrevious.avg_response_hours,
        individualReviewsCurrent.avg_response_hours,
      ]),
      prsReviewed: buildHistorySeries([
        individualReviewsPrevious4.prs_reviewed,
        individualReviewsPrevious3.prs_reviewed,
        individualReviewsPrevious2.prs_reviewed,
        individualReviewsPrevious.prs_reviewed,
        individualReviewsCurrent.prs_reviewed,
      ]),
      reviewComments: buildHistorySeries([
        individualReviewsPrevious4.review_comments,
        individualReviewsPrevious3.review_comments,
        individualReviewsPrevious2.review_comments,
        individualReviewsPrevious.review_comments,
        individualReviewsCurrent.review_comments,
      ]),
      reviewCoverage: buildHistorySeries([
        individualCoveragePrevious4.coverage,
        individualCoveragePrevious3.coverage,
        individualCoveragePrevious2.coverage,
        individualCoveragePrevious.coverage,
        individualCoverageCurrent.coverage,
      ]),
      reviewParticipation: buildHistorySeries([
        individualCoveragePrevious4.participation,
        individualCoveragePrevious3.participation,
        individualCoveragePrevious2.participation,
        individualCoveragePrevious.participation,
        individualCoverageCurrent.participation,
      ]),
      reopenedIssues: buildHistorySeries([
        individualIssuesPrevious4.reopened,
        individualIssuesPrevious3.reopened,
        individualIssuesPrevious2.reopened,
        individualIssuesPrevious.reopened,
        individualIssuesCurrent.reopened,
      ]),
      discussionComments: buildHistorySeries([
        individualDiscussionPrevious4.comments,
        individualDiscussionPrevious3.comments,
        individualDiscussionPrevious2.comments,
        individualDiscussionPrevious.comments,
        individualDiscussionCurrent.comments,
      ]),
    } satisfies IndividualMetricHistory;

    individual = {
      person: personProfile,
      metrics: individualMetrics,
      metricHistory: individualHistory,
      trends: {
        monthly: individualMonthly,
        repoActivity: mapRepoDistribution(
          filteredIndividualRepoRows,
          repoProfileMap,
        ),
        reviewHeatmap: individualReviewHeatmap,
        activityHeatmap: individualActivityHeatmap,
      },
      repoComparison: mapRepoComparison(
        filteredIndividualRepoComparisonRows,
        repoProfileMap,
      ),
    };
  }

  const leaderboardProfiles = new Set<string>();
  leaderboardPrsVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardPrsMergedVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardPrsMergedByVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardPrCompletenessVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardIssuesVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardReviewsVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardRespondersVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardCommentsVisible.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  mainBranchContributionVisibleRows.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  organization.reviewers.forEach((reviewer) => {
    if (reviewer.reviewerId) {
      leaderboardProfiles.add(reviewer.reviewerId);
    }
  });

  const leaderboardMap = new Map<string, UserProfile>();
  leaderboardProfiles.forEach((id) => {
    const profile = userProfileMap.get(id);
    if (profile) {
      leaderboardMap.set(id, profile);
    }
  });

  const activeMainBranchContributionEntries: LeaderboardEntry[] = [];
  const mainBranchContributionEntries: LeaderboardEntry[] =
    mainBranchContributionVisibleRows.map((row) => {
      const reviewCount = Number(row.review_count ?? 0);
      const activeReviewCount = Number(row.active_review_count ?? 0);
      const authorCount = Number(row.author_count ?? 0);
      const additions = Number(row.additions ?? 0);
      const deletions = Number(row.deletions ?? 0);
      const activeAdditions = Number(row.active_additions ?? 0);
      const activeDeletions = Number(row.active_deletions ?? 0);

      const user = leaderboardMap.get(row.user_id) ??
        userProfileMap.get(row.user_id) ?? {
          id: row.user_id,
          login: null,
          name: null,
          avatarUrl: null,
        };

      activeMainBranchContributionEntries.push({
        user,
        value: authorCount + activeReviewCount,
        secondaryValue: activeReviewCount,
        details: [
          {
            label: "PR",
            value: authorCount,
            suffix: "건",
          },
          {
            label: "+",
            value: activeAdditions,
            sign: "positive",
            suffix: "라인",
          },
          {
            label: "-",
            value: activeDeletions,
            sign: "negative",
            suffix: "라인",
          },
        ],
      });

      return {
        user,
        value: reviewCount + authorCount,
        secondaryValue: reviewCount,
        details: [
          {
            label: "PR",
            value: authorCount,
            suffix: "건",
          },
          {
            label: "+",
            value: additions,
            sign: "positive",
            suffix: "라인",
          },
          {
            label: "-",
            value: deletions,
            sign: "negative",
            suffix: "라인",
          },
        ],
      } satisfies LeaderboardEntry;
    });

  const activeReviewerEntries: LeaderboardEntry[] = organization.reviewers
    .map((reviewer) => {
      const activeCount = Number(reviewer.activeReviewCount ?? 0);
      const user = reviewer.profile ?? {
        id: reviewer.reviewerId,
        login: null,
        name: null,
        avatarUrl: null,
      };

      return {
        user,
        value: activeCount,
      } satisfies LeaderboardEntry;
    })
    .filter((entry) => entry.value > 0)
    .sort((a, b) => {
      if (b.value === a.value) {
        const nameA = a.user.login ?? a.user.name ?? a.user.id;
        const nameB = b.user.login ?? b.user.name ?? b.user.id;
        return nameA.localeCompare(nameB);
      }
      return b.value - a.value;
    });

  const leaderboard: LeaderboardSummary = {
    prsCreated: mapLeaderboard(leaderboardPrsVisible, leaderboardMap),
    prsMerged: mapLeaderboard(leaderboardPrsMergedVisible, leaderboardMap),
    prsMergedBy: mapLeaderboard(leaderboardPrsMergedByVisible, leaderboardMap),
    prCompleteness: mapPrCompletionLeaderboard(
      leaderboardPrCompletenessVisible,
      leaderboardMap,
    ),
    issuesCreated: mapLeaderboard(leaderboardIssuesVisible, leaderboardMap),
    reviewsCompleted: mapLeaderboard(leaderboardReviewsVisible, leaderboardMap),
    fastestResponders: mapLeaderboard(
      leaderboardRespondersVisible,
      leaderboardMap,
    ),
    discussionEngagement: mapLeaderboard(
      leaderboardCommentsVisible,
      leaderboardMap,
    ),
    activeReviewerActivity: activeReviewerEntries,
    activeMainBranchContribution: activeMainBranchContributionEntries,
    mainBranchContribution: mainBranchContributionEntries,
  };

  const activeContributors = contributorIds.length
    ? (await getUserProfiles(contributorIds)).filter(
        (user) => !excludedUserIds.has(user.id),
      )
    : [];

  const allContributors = await listAllUsers();
  const contributors = allContributors.filter(
    (user) => !excludedUserIds.has(user.id),
  );

  return {
    range,
    repositories: filteredRepositories,
    contributors,
    activeContributors,
    organization,
    individual,
    leaderboard,
    timeZone,
    weekStart,
  };
}

export const __test__ = {
  buildDurationComparison,
  buildHistorySeries,
  summarizeIssueDurations,
};
