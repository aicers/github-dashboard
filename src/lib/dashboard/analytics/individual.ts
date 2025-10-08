import type {
  RepoComparisonRawRow,
  RepoDistributionRow,
} from "@/lib/dashboard/analytics/repositories";
import { fetchReviewResponsePairs } from "@/lib/dashboard/analytics/reviews";
import {
  averageBusinessResponseHours,
  DEPENDABOT_FILTER,
  HOLIDAY_SET,
} from "@/lib/dashboard/analytics/shared";
import type { HeatmapCell, MultiTrendPoint } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";

type IndividualIssueRow = {
  created: number;
  closed: number;
  avg_resolution_hours: number | null;
  reopened: number;
};

type IndividualReviewRow = {
  reviews: number;
  active_reviews: number;
  avg_response_hours: number | null;
  prs_reviewed: number;
  active_prs_reviewed: number;
  review_comments: number;
};

type IndividualReviewBaseRow = {
  reviews: number;
  prs_reviewed: number;
  active_reviews: number;
  active_prs_reviewed: number;
  review_comments: number;
};

type IndividualPullRequestRow = {
  created: number;
  merged: number;
};

type IndividualMergedByRow = {
  merged: number;
};

export type IndividualPrCompletionRow = {
  merged_prs: number;
  commented_count: number;
  changes_requested_count: number;
};

type IndividualCoverageRow = {
  coverage: number | null;
  participation: number | null;
};

type IndividualDiscussionRow = {
  comments: number;
};

type IndividualMonthlyRow = {
  bucket: string;
  issues: number;
  reviews: number;
};

type IndividualRepoActivityRow = RepoDistributionRow;

type IndividualReviewHeatmapRow = {
  dow: number;
  hour: number;
  count: number;
};

export async function fetchIndividualIssueMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualIssueRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND i.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualIssueRow>(
    `SELECT
       COUNT(*) FILTER (WHERE i.github_created_at BETWEEN $2 AND $3) AS created,
       COUNT(*) FILTER (WHERE i.github_closed_at BETWEEN $2 AND $3) AS closed,
       AVG(EXTRACT(EPOCH FROM (i.github_closed_at - i.github_created_at)) / 3600.0)
         FILTER (WHERE i.github_closed_at BETWEEN $2 AND $3 AND i.github_closed_at IS NOT NULL) AS avg_resolution_hours,
       COUNT(*) FILTER (WHERE i.github_closed_at BETWEEN $2 AND $3 AND i.state = 'OPEN') AS reopened
     FROM issues i
     WHERE i.author_id = $1${repoClause}`,
    params,
  );

  return (
    result.rows[0] ?? {
      created: 0,
      closed: 0,
      avg_resolution_hours: null,
      reopened: 0,
    }
  );
}

export async function fetchIndividualPullRequestMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualPullRequestRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND p.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualPullRequestRow>(
    `SELECT
       COUNT(*) FILTER (WHERE p.github_created_at BETWEEN $2 AND $3) AS created,
       COUNT(*) FILTER (WHERE p.github_merged_at BETWEEN $2 AND $3) AS merged
     FROM pull_requests p
     WHERE p.author_id = $1${repoClause}`,
    params,
  );

  return (
    result.rows[0] ?? {
      created: 0,
      merged: 0,
    }
  );
}

export async function fetchIndividualMergedByMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualMergedByRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualMergedByRow>(
    `SELECT
       COUNT(*) FILTER (WHERE pr.github_merged_at BETWEEN $2 AND $3) AS merged
     FROM pull_requests pr
     LEFT JOIN users u ON u.id = pr.data -> 'mergedBy' ->> 'id'
     WHERE pr.data -> 'mergedBy' ->> 'id' = $1${repoClause}
       AND pr.github_merged_at IS NOT NULL
       AND ${DEPENDABOT_FILTER}`,
    params,
  );

  return (
    result.rows[0] ?? {
      merged: 0,
    }
  );
}

export async function fetchIndividualPrCompletionMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualPrCompletionRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualPrCompletionRow>(
    `WITH merged_prs AS (
       SELECT
         pr.id,
         pr.author_id,
         pr.github_merged_at,
         pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at BETWEEN $2 AND $3
         AND pr.github_merged_at IS NOT NULL
         AND pr.author_id = $1
         AND ${DEPENDABOT_FILTER}
         ${repoClause}
     ),
     review_totals AS (
       SELECT
         mp.id,
         COUNT(*) FILTER (WHERE r.state = 'COMMENTED') AS commented_count,
         COUNT(*) FILTER (WHERE r.state = 'CHANGES_REQUESTED') AS changes_requested_count
       FROM merged_prs mp
       LEFT JOIN reviews r
         ON r.pull_request_id = mp.id
        AND r.author_id IS NOT NULL
        AND r.author_id <> mp.author_id
        AND r.state IN ('COMMENTED', 'CHANGES_REQUESTED')
        AND (r.github_submitted_at IS NULL OR r.github_submitted_at <= mp.github_merged_at)
       GROUP BY mp.id
     )
     SELECT
       COUNT(*) AS merged_prs,
       COALESCE(SUM(review_totals.commented_count), 0) AS commented_count,
       COALESCE(SUM(review_totals.changes_requested_count), 0) AS changes_requested_count
     FROM merged_prs
     LEFT JOIN review_totals ON review_totals.id = merged_prs.id`,
    params,
  );

  return (
    result.rows[0] ?? {
      merged_prs: 0,
      commented_count: 0,
      changes_requested_count: 0,
    }
  );
}

export async function fetchIndividualReviewMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualReviewRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const statsResult = await query<IndividualReviewBaseRow>(
    `WITH reviewer_reviews AS (
       SELECT r.pull_request_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1
         AND r.github_submitted_at BETWEEN $2 AND $3${repoClause}
         AND pr.author_id <> $1
         AND COALESCE(r.state, '') <> 'DISMISSED'
         AND ${DEPENDABOT_FILTER}
     ),
     approved_reviews AS (
       SELECT r.pull_request_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1
         AND r.github_submitted_at BETWEEN $2 AND $3${repoClause}
         AND pr.author_id <> $1
         AND r.state = 'APPROVED'
         AND ${DEPENDABOT_FILTER}
     ),
     review_comments AS (
       SELECT COUNT(*) AS review_comments
       FROM comments c
       JOIN pull_requests pr ON pr.id = c.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE c.author_id = $1
         AND c.github_created_at BETWEEN $2 AND $3${repoClause}
         AND pr.author_id <> $1
         AND ${DEPENDABOT_FILTER}
     )
     SELECT
       (SELECT COUNT(*) FROM reviewer_reviews) AS reviews,
       (SELECT COUNT(DISTINCT pull_request_id) FROM reviewer_reviews) AS prs_reviewed,
       (SELECT COUNT(*) FROM approved_reviews) AS active_reviews,
       (SELECT COUNT(DISTINCT pull_request_id) FROM approved_reviews) AS active_prs_reviewed,
       (SELECT review_comments FROM review_comments) AS review_comments
     `,
    params,
  );

  const statsRow = statsResult.rows[0] ?? {
    reviews: 0,
    prs_reviewed: 0,
    active_reviews: 0,
    active_prs_reviewed: 0,
    review_comments: 0,
  };

  const responsePairs = await fetchReviewResponsePairs(
    start,
    end,
    repositoryIds,
    personId,
  );

  const avgResponseHours = averageBusinessResponseHours(
    responsePairs.map((row) => ({
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
    })),
    HOLIDAY_SET,
  );

  return {
    reviews: Number(statsRow.reviews ?? 0),
    active_reviews: Number(statsRow.active_reviews ?? 0),
    prs_reviewed: Number(statsRow.prs_reviewed ?? 0),
    active_prs_reviewed: Number(statsRow.active_prs_reviewed ?? 0),
    avg_response_hours: avgResponseHours,
    review_comments: Number(statsRow.review_comments ?? 0),
  };
}

export async function fetchIndividualCoverageMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualCoverageRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualCoverageRow>(
    `WITH prs_in_range AS (
       SELECT pr.id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at IS NOT NULL
         AND pr.github_merged_at BETWEEN $2 AND $3${repoClause}
         AND ${DEPENDABOT_FILTER}
     ),
     reviewer_prs AS (
       SELECT DISTINCT r.pull_request_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1
         AND r.github_submitted_at BETWEEN $2 AND $3${repoClause}
         AND pr.github_merged_at IS NOT NULL
         AND pr.github_merged_at BETWEEN $2 AND $3
         AND ${DEPENDABOT_FILTER}
     ),
     participation AS (
       SELECT
         pr.id,
         COUNT(DISTINCT r.author_id) FILTER (WHERE r.github_submitted_at BETWEEN $2 AND $3) AS reviewer_count
       FROM pull_requests pr
       LEFT JOIN reviews r ON r.pull_request_id = pr.id
       WHERE pr.id IN (SELECT id FROM prs_in_range)
       GROUP BY pr.id
     ),
     person_participation AS (
       SELECT
         pr.id,
         COUNT(DISTINCT r.author_id) FILTER (WHERE r.github_submitted_at BETWEEN $2 AND $3) AS reviewer_count
       FROM pull_requests pr
       JOIN reviews r ON r.pull_request_id = pr.id
       WHERE pr.id IN (SELECT pull_request_id FROM reviewer_prs)
       GROUP BY pr.id
     )
     SELECT
       CASE WHEN (SELECT COUNT(*) FROM prs_in_range) = 0 THEN NULL
            ELSE (SELECT COUNT(*) FROM reviewer_prs)::numeric / (SELECT COUNT(*) FROM prs_in_range)::numeric
       END AS coverage,
       (SELECT AVG(reviewer_count) FROM person_participation) AS participation
     `,
    params,
  );

  return (
    result.rows[0] ?? {
      coverage: null,
      participation: null,
    }
  );
}

export async function fetchIndividualDiscussion(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualDiscussionRow> {
  const params: unknown[] = [personId, start, end];
  let repoClauseIssue = "";
  let repoClausePr = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualDiscussionRow>(
    `SELECT COUNT(*) AS comments
     FROM comments c
     LEFT JOIN issues i ON i.id = c.issue_id
     LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
     WHERE c.author_id = $1 AND c.github_created_at BETWEEN $2 AND $3
       AND (
         (c.issue_id IS NOT NULL${repoClauseIssue})
         OR (c.pull_request_id IS NOT NULL${repoClausePr})
       )`,
    params,
  );

  return result.rows[0] ?? { comments: 0 };
}

export async function fetchIndividualMonthlyTrends(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<MultiTrendPoint[]> {
  const params: unknown[] = [personId, start, end];
  let repoClauseIssues = "";
  let repoClauseReviews = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const result = await query<IndividualMonthlyRow>(
    `WITH issue_trend AS (
       SELECT to_char(date_trunc('month', i.github_created_at AT TIME ZONE $${timezoneIndex}), 'YYYY-MM') AS bucket,
              COUNT(*) AS issues
       FROM issues i
       WHERE i.author_id = $1 AND i.github_created_at BETWEEN $2 AND $3${repoClauseIssues}
       GROUP BY bucket
     ),
     review_trend AS (
       SELECT to_char(date_trunc('month', r.github_submitted_at AT TIME ZONE $${timezoneIndex}), 'YYYY-MM') AS bucket,
              COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1 AND r.github_submitted_at BETWEEN $2 AND $3${repoClauseReviews}
         AND ${DEPENDABOT_FILTER}
       GROUP BY bucket
     ),
     combined AS (
       SELECT
         COALESCE(i.bucket, r.bucket) AS bucket,
         COALESCE(i.issues, 0) AS issues,
         COALESCE(r.reviews, 0) AS reviews
       FROM issue_trend i
       FULL OUTER JOIN review_trend r ON r.bucket = i.bucket
     )
     SELECT bucket, issues, reviews
     FROM combined
     ORDER BY bucket`,
    [...params, timeZone],
  );

  return result.rows.map((row) => ({
    date: row.bucket,
    values: {
      issues: row.issues,
      reviews: row.reviews,
    },
  }));
}

export async function fetchIndividualRepoActivity(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoDistributionRow[]> {
  const params: unknown[] = [personId, start, end];
  let repoFilter = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoFilter = ` AND repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualRepoActivityRow>(
    `WITH issue_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS issues
       FROM issues
       WHERE author_id = $1 AND github_created_at BETWEEN $2 AND $3
       GROUP BY repository_id
     ),
     review_counts AS (
       SELECT pr.repository_id AS repo_id, COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1 AND r.github_submitted_at BETWEEN $2 AND $3
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
     comment_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS comments
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.author_id = $1 AND c.github_created_at BETWEEN $2 AND $3
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         WHERE c.author_id = $1 AND c.github_created_at BETWEEN $2 AND $3
       ) combined
       GROUP BY repository_id
     ),
     combined AS (
       SELECT
         COALESCE(ic.repo_id, rc.repo_id, cc.repo_id) AS repository_id,
         COALESCE(ic.issues, 0) AS issues,
         0 AS pull_requests,
         COALESCE(rc.reviews, 0) AS reviews,
         COALESCE(cc.comments, 0) AS comments
       FROM issue_counts ic
       FULL OUTER JOIN review_counts rc ON rc.repo_id = ic.repo_id
       FULL OUTER JOIN comment_counts cc ON cc.repo_id = COALESCE(ic.repo_id, rc.repo_id)
     )
     SELECT *, (issues + reviews + comments) AS total_events
     FROM combined
     WHERE repository_id IS NOT NULL${repoFilter}
     ORDER BY total_events DESC`,
    params,
  );

  return result.rows;
}

export async function fetchIndividualRepoComparison(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoComparisonRawRow[]> {
  const params: unknown[] = [personId, start, end];
  let repoFilterPr = "";
  let repoFilterIssues = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoFilterPr = ` AND repository_id = ANY($${index}::text[])`;
    repoFilterIssues = ` AND repository_id = ANY($${index}::text[])`;
  }

  const result = await query<RepoComparisonRawRow>(
    `WITH repo_ids AS (
       SELECT DISTINCT repository_id
       FROM issues
       WHERE author_id = $1
         AND (github_created_at BETWEEN $2 AND $3 OR github_closed_at BETWEEN $2 AND $3)${repoFilterIssues}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.author_id = $1
         AND (pr.github_created_at BETWEEN $2 AND $3 OR pr.github_merged_at BETWEEN $2 AND $3)${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.data -> 'mergedBy' ->> 'id'
       WHERE pr.data -> 'mergedBy' ->> 'id' = $1
         AND pr.github_merged_at BETWEEN $2 AND $3${repoFilterPr}
         AND pr.github_merged_at IS NOT NULL
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1
         AND r.github_submitted_at BETWEEN $2 AND $3${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT repository_id
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.author_id = $1
           AND c.github_created_at BETWEEN $2 AND $3${repoFilterIssues}
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE c.author_id = $1
           AND c.github_created_at BETWEEN $2 AND $3${repoFilterPr}
           AND ${DEPENDABOT_FILTER}
       ) AS comment_repo_ids
     ),
     issue_created_counts AS (
       SELECT repository_id, COUNT(*) AS issues_created
       FROM issues
       WHERE author_id = $1
         AND github_created_at BETWEEN $2 AND $3${repoFilterIssues}
       GROUP BY repository_id
     ),
     issue_counts AS (
       SELECT repository_id, COUNT(*) AS issues_resolved
       FROM issues
       WHERE author_id = $1
         AND github_closed_at BETWEEN $2 AND $3${repoFilterIssues}
       GROUP BY repository_id
     ),
     pr_created_counts AS (
       SELECT pr.repository_id, COUNT(*) AS prs_created
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.author_id = $1
         AND pr.github_created_at BETWEEN $2 AND $3${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
     pr_counts AS (
       SELECT pr.repository_id, COUNT(*) AS prs_merged
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.author_id = $1
         AND pr.github_merged_at BETWEEN $2 AND $3${repoFilterPr}
         AND pr.github_merged_at IS NOT NULL
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
     pr_merged_by_counts AS (
       SELECT pr.repository_id, COUNT(*) AS prs_merged_by
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.data -> 'mergedBy' ->> 'id'
       WHERE pr.data -> 'mergedBy' ->> 'id' = $1
         AND pr.github_merged_at BETWEEN $2 AND $3${repoFilterPr}
         AND pr.github_merged_at IS NOT NULL
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
    review_counts AS (
      SELECT
        pr.repository_id,
        COUNT(*) AS reviews,
        COUNT(*) FILTER (WHERE r.state = 'APPROVED') AS active_reviews
      FROM reviews r
      JOIN pull_requests pr ON pr.id = r.pull_request_id
      LEFT JOIN users u ON u.id = pr.author_id
      WHERE r.author_id = $1
        AND r.github_submitted_at BETWEEN $2 AND $3${repoFilterPr}
        AND COALESCE(r.state, '') <> 'DISMISSED'
        AND ${DEPENDABOT_FILTER}
      GROUP BY pr.repository_id
    ),
     comment_counts AS (
       SELECT repository_id, COUNT(*) AS comments
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.author_id = $1
           AND c.github_created_at BETWEEN $2 AND $3${repoFilterIssues}
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE c.author_id = $1
           AND c.github_created_at BETWEEN $2 AND $3${repoFilterPr}
           AND ${DEPENDABOT_FILTER}
       ) AS combined
       GROUP BY repository_id
     ),
     first_review_times AS (
       SELECT
         pr.repository_id,
         pr.github_created_at,
         MIN(r.github_submitted_at) AS first_review_at
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       LEFT JOIN reviews r ON r.pull_request_id = pr.id
       WHERE pr.author_id = $1
         AND pr.github_created_at BETWEEN $2 AND $3${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id, pr.id, pr.github_created_at
     ),
     first_reviews AS (
       SELECT
         repository_id,
         AVG(EXTRACT(EPOCH FROM (first_review_at - github_created_at)) / 3600.0) AS avg_first_review_hours
       FROM first_review_times
       WHERE first_review_at IS NOT NULL
       GROUP BY repository_id
     )
     SELECT
       repo_ids.repository_id,
       COALESCE(issue_created_counts.issues_created, 0) AS issues_created,
       COALESCE(issue_counts.issues_resolved, 0) AS issues_resolved,
       COALESCE(pr_created_counts.prs_created, 0) AS prs_created,
       COALESCE(pr_counts.prs_merged, 0) AS prs_merged,
       COALESCE(pr_merged_by_counts.prs_merged_by, 0) AS prs_merged_by,
       COALESCE(review_counts.reviews, 0) AS reviews,
       COALESCE(review_counts.active_reviews, 0) AS active_reviews,
       COALESCE(comment_counts.comments, 0) AS comments,
       first_reviews.avg_first_review_hours
     FROM repo_ids
     LEFT JOIN issue_created_counts ON issue_created_counts.repository_id = repo_ids.repository_id
     LEFT JOIN issue_counts ON issue_counts.repository_id = repo_ids.repository_id
     LEFT JOIN pr_created_counts ON pr_created_counts.repository_id = repo_ids.repository_id
     LEFT JOIN pr_counts ON pr_counts.repository_id = repo_ids.repository_id
     LEFT JOIN pr_merged_by_counts ON pr_merged_by_counts.repository_id = repo_ids.repository_id
     LEFT JOIN review_counts ON review_counts.repository_id = repo_ids.repository_id
     LEFT JOIN comment_counts ON comment_counts.repository_id = repo_ids.repository_id
     LEFT JOIN first_reviews ON first_reviews.repository_id = repo_ids.repository_id`,
    params,
  );

  return result.rows;
}

export async function fetchIndividualReviewHeatmap(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<HeatmapCell[]> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const result = await query<IndividualReviewHeatmapRow>(
    `SELECT
       EXTRACT(DOW FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
       EXTRACT(HOUR FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
       COUNT(*)
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     LEFT JOIN users u ON u.id = pr.author_id
     WHERE r.author_id = $1
       AND r.github_submitted_at BETWEEN $2 AND $3${repoClause}
       AND pr.author_id <> $1
       AND COALESCE(r.state, '') <> 'DISMISSED'
       AND ${DEPENDABOT_FILTER}
     GROUP BY dow, hour
     ORDER BY dow, hour`,
    [...params, timeZone],
  );

  return result.rows.map((row) => ({
    day: row.dow,
    hour: row.hour,
    count: Number(row.count ?? 0),
  }));
}

export async function fetchIndividualActivityHeatmap(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<HeatmapCell[]> {
  const params: unknown[] = [personId, start, end];
  let repoClauseIssues = "";
  let repoClausePrAuthored = "";
  let repoClausePrMerged = "";
  let repoClauseReview = "";
  let repoClauseCommentIssue = "";
  let repoClauseCommentPr = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePrAuthored = ` AND p.repository_id = ANY($${index}::text[])`;
    repoClausePrMerged = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseReview = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseCommentIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseCommentPr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const result = await query<IndividualReviewHeatmapRow>(
    `WITH issue_events AS (
       SELECT
         EXTRACT(DOW FROM (i.github_created_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
         EXTRACT(HOUR FROM (i.github_created_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
         COUNT(*) AS count
       FROM issues i
       WHERE i.author_id = $1
         AND i.github_created_at BETWEEN $2 AND $3${repoClauseIssues}
       GROUP BY dow, hour
     ),
     pr_created_events AS (
       SELECT
         EXTRACT(DOW FROM (p.github_created_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
         EXTRACT(HOUR FROM (p.github_created_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
         COUNT(*) AS count
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.author_id = $1
         AND p.github_created_at BETWEEN $2 AND $3${repoClausePrAuthored}
         AND ${DEPENDABOT_FILTER}
       GROUP BY dow, hour
     ),
     pr_merged_events AS (
       SELECT
         EXTRACT(DOW FROM (pr.github_merged_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
         EXTRACT(HOUR FROM (pr.github_merged_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
         COUNT(*) AS count
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.data -> 'mergedBy' ->> 'id' = $1
         AND pr.github_merged_at IS NOT NULL
         AND pr.github_merged_at BETWEEN $2 AND $3${repoClausePrMerged}
         AND ${DEPENDABOT_FILTER}
       GROUP BY dow, hour
     ),
     review_events AS (
       SELECT
         EXTRACT(DOW FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
         EXTRACT(HOUR FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
         COUNT(*) AS count
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.author_id = $1
         AND r.github_submitted_at BETWEEN $2 AND $3${repoClauseReview}
         AND pr.author_id <> $1
         AND COALESCE(r.state, '') <> 'DISMISSED'
         AND ${DEPENDABOT_FILTER}
       GROUP BY dow, hour
     ),
     comment_events AS (
       SELECT
         EXTRACT(DOW FROM (c.github_created_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
         EXTRACT(HOUR FROM (c.github_created_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
         COUNT(*) AS count
       FROM comments c
       LEFT JOIN issues i ON i.id = c.issue_id
       LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
       WHERE c.author_id = $1
         AND c.github_created_at BETWEEN $2 AND $3
         AND (
           (c.issue_id IS NOT NULL${repoClauseCommentIssue})
           OR (c.pull_request_id IS NOT NULL${repoClauseCommentPr})
         )
       GROUP BY dow, hour
     ),
     combined AS (
       SELECT * FROM issue_events
       UNION ALL
       SELECT * FROM pr_created_events
       UNION ALL
       SELECT * FROM pr_merged_events
       UNION ALL
       SELECT * FROM review_events
       UNION ALL
       SELECT * FROM comment_events
     )
     SELECT dow, hour, SUM(count) AS count
     FROM combined
     GROUP BY dow, hour
     ORDER BY dow, hour`,
    [...params, timeZone],
  );

  return result.rows.map((row) => ({
    day: row.dow,
    hour: row.hour,
    count: Number(row.count ?? 0),
  }));
}
