import { fetchReviewResponsePairs } from "@/lib/dashboard/analytics/reviews";
import { DEPENDABOT_FILTER } from "@/lib/dashboard/analytics/shared";
import {
  calculateBusinessHoursBetween,
  HOLIDAY_SET,
} from "@/lib/dashboard/business-days";
import { query } from "@/lib/db/client";

export type LeaderboardRow = {
  user_id: string;
  value: number;
  secondary_value?: number | null;
  additions?: number;
  deletions?: number;
};

export type PrCompletionLeaderboardRow = {
  user_id: string;
  value: number;
  merged_prs: number;
  commented_count: number;
  changes_requested_count: number;
};

type LeaderboardMetric =
  | "prs"
  | "prsMerged"
  | "prsMergedBy"
  | "issues"
  | "reviews"
  | "response"
  | "comments";

export async function fetchLeaderboard(
  metric: LeaderboardMetric,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<LeaderboardRow[]> {
  const params: unknown[] = [start, end];
  let repoClauseIssues = "";
  let repoClausePrs = "";
  let repoClauseCommentsIssue = "";
  let repoClauseCommentsPr = "";
  let repoClauseReviews = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePrs = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsPr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  switch (metric) {
    case "prs": {
      const result = await query<LeaderboardRow>(
        `SELECT pr.author_id AS user_id,
                COUNT(*) FILTER (WHERE pr.github_created_at BETWEEN $1 AND $2) AS value,
                COUNT(*) FILTER (WHERE pr.github_merged_at BETWEEN $1 AND $2) AS secondary_value
         FROM pull_requests pr
         LEFT JOIN users u ON u.id = pr.author_id
         WHERE pr.author_id IS NOT NULL${repoClausePrs}
           AND ${DEPENDABOT_FILTER}
         GROUP BY pr.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "prsMerged": {
      const result = await query<LeaderboardRow>(
        `SELECT pr.author_id AS user_id, COUNT(*) AS value,
                SUM((pr.data ->> 'additions')::numeric) AS additions,
                SUM((pr.data ->> 'deletions')::numeric) AS deletions
         FROM pull_requests pr
         LEFT JOIN users u ON u.id = pr.author_id
         WHERE pr.author_id IS NOT NULL AND pr.github_merged_at BETWEEN $1 AND $2${repoClausePrs}
           AND ${DEPENDABOT_FILTER}
         GROUP BY pr.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "prsMergedBy": {
      const result = await query<LeaderboardRow>(
        `SELECT pr.data -> 'mergedBy' ->> 'id' AS user_id, COUNT(*) AS value
         FROM pull_requests pr
         LEFT JOIN users u ON u.id = pr.data -> 'mergedBy' ->> 'id'
         WHERE pr.github_merged_at BETWEEN $1 AND $2${repoClausePrs}
           AND pr.data -> 'mergedBy' ->> 'id' IS NOT NULL
           AND ${DEPENDABOT_FILTER}
         GROUP BY user_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "issues": {
      const result = await query<LeaderboardRow>(
        `SELECT i.author_id AS user_id, COUNT(*) AS value
         FROM issues i
         WHERE i.author_id IS NOT NULL${repoClauseIssues}
           AND i.github_created_at BETWEEN $1 AND $2
         GROUP BY i.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "reviews": {
      const result = await query<LeaderboardRow>(
        `SELECT r.author_id AS user_id,
                COUNT(*) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS value,
                COUNT(DISTINCT r.pull_request_id) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS secondary_value
         FROM reviews r
         JOIN pull_requests pr ON pr.id = r.pull_request_id
         WHERE r.author_id IS NOT NULL${repoClauseReviews}
         GROUP BY r.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "response": {
      const responsePairs = await fetchReviewResponsePairs(
        start,
        end,
        repositoryIds,
      );
      const stats = new Map<string, { sum: number; count: number }>();
      responsePairs.forEach((row) => {
        if (!row.reviewer_id) {
          return;
        }

        const hours = calculateBusinessHoursBetween(
          row.requested_at,
          row.responded_at,
          HOLIDAY_SET,
        );
        if (hours === null || !Number.isFinite(hours)) {
          return;
        }

        const current = stats.get(row.reviewer_id) ?? { sum: 0, count: 0 };
        current.sum += hours;
        current.count += 1;
        stats.set(row.reviewer_id, current);
      });

      return Array.from(stats.entries())
        .map(([userId, { sum, count }]) => ({
          user_id: userId,
          value: sum / count,
          secondary_value: count,
        }))
        .sort((a, b) => a.value - b.value);
    }
    case "comments": {
      const result = await query<LeaderboardRow>(
        `SELECT c.author_id AS user_id, COUNT(*) AS value
         FROM comments c
         LEFT JOIN issues i ON i.id = c.issue_id
         LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
         WHERE c.author_id IS NOT NULL AND c.github_created_at BETWEEN $1 AND $2
           AND (
             (c.issue_id IS NOT NULL${repoClauseCommentsIssue})
             OR (c.pull_request_id IS NOT NULL${repoClauseCommentsPr})
           )
         GROUP BY c.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    default:
      return [];
  }
}

export async function fetchPrCompletionLeaderboard(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<PrCompletionLeaderboardRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    repoClause = ` AND pr.repository_id = ANY($${params.length}::text[])`;
  }

  const result = await query<PrCompletionLeaderboardRow>(
    `WITH merged_prs AS (
       SELECT
         pr.id,
         pr.author_id,
         pr.github_merged_at,
         pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at BETWEEN $1 AND $2
         AND pr.github_merged_at IS NOT NULL
         AND pr.author_id IS NOT NULL
         AND ${DEPENDABOT_FILTER}
         ${repoClause}
    ),
     review_totals AS (
       SELECT
         mp.id,
         mp.author_id,
         COUNT(*) FILTER (WHERE r.state = 'COMMENTED') AS commented_count,
         COUNT(*) FILTER (WHERE r.state = 'CHANGES_REQUESTED') AS changes_requested_count
       FROM merged_prs mp
       LEFT JOIN reviews r
         ON r.pull_request_id = mp.id
         AND r.author_id IS NOT NULL
         AND r.author_id <> mp.author_id
         AND r.state IN ('COMMENTED', 'CHANGES_REQUESTED')
         AND (r.github_submitted_at IS NULL OR r.github_submitted_at <= mp.github_merged_at)
       GROUP BY mp.id, mp.author_id
     ),
     author_totals AS (
       SELECT
         author_id,
         COUNT(*) AS merged_prs,
         SUM(commented_count) AS commented_count,
         SUM(changes_requested_count) AS changes_requested_count
       FROM review_totals
       GROUP BY author_id
     )
     SELECT
       author_id AS user_id,
       COALESCE(((commented_count + changes_requested_count)::numeric) / NULLIF(merged_prs, 0), 0) AS value,
       merged_prs,
       commented_count,
       changes_requested_count
     FROM author_totals
     WHERE merged_prs > 0
     ORDER BY value ASC, merged_prs DESC, author_id`,
    params,
  );

  return result.rows.map((row) => ({
    user_id: row.user_id,
    value: Number(row.value ?? 0),
    merged_prs: Number(row.merged_prs ?? 0),
    commented_count: Number(row.commented_count ?? 0),
    changes_requested_count: Number(row.changes_requested_count ?? 0),
  }));
}
