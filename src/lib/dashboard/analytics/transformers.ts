import type { ReviewerActivityRow } from "@/lib/dashboard/analytics/engagement";
import type {
  LeaderboardRow,
  PrCompletionLeaderboardRow,
} from "@/lib/dashboard/analytics/leaderboards";
import type {
  RepoComparisonRawRow,
  RepoDistributionRow,
} from "@/lib/dashboard/analytics/repositories";
import type {
  LeaderboardEntry,
  RepoComparisonRow,
  RepoDistributionItem,
  ReviewerActivity,
  TrendPoint,
} from "@/lib/dashboard/types";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

export function mapRepoDistribution(
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

export function mapRepoComparison(
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

export function mapReviewerActivity(
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

export function mapLeaderboard(
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

export function mapPrCompletionLeaderboard(
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

export function toTrend(points: TrendPoint[]): TrendPoint[] {
  return points.map((point) => ({
    date: point.date,
    value: Number(point.value ?? 0),
  }));
}
