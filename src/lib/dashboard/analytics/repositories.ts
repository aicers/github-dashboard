import { DEPENDABOT_FILTER } from "@/lib/dashboard/analytics/shared";
import { query } from "@/lib/db/client";

export type RepoDistributionRow = {
  repository_id: string;
  issues: number;
  pull_requests: number;
  reviews: number;
  comments: number;
  total_events: number;
};

export type RepoComparisonRawRow = {
  repository_id: string;
  issues_created: number;
  issues_resolved: number;
  prs_created: number;
  prs_merged: number;
  prs_merged_by: number;
  reviews: number;
  active_reviews: number;
  comments: number;
  avg_first_review_hours: number | string | null;
};

export async function fetchRepoDistribution(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoDistributionRow[]> {
  const params: unknown[] = [start, end];
  let repoFilter = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoFilter = ` AND repository_id = ANY($${index}::text[])`;
  }

  const result = await query<RepoDistributionRow>(
    `WITH issue_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS issues
       FROM issues
       WHERE github_created_at BETWEEN $1 AND $2
       GROUP BY repository_id
     ),
     pr_counts AS (
       SELECT p.repository_id AS repo_id, COUNT(*) AS pull_requests
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.github_created_at BETWEEN $1 AND $2
         AND ${DEPENDABOT_FILTER}
       GROUP BY p.repository_id
     ),
    review_counts AS (
      SELECT pr.repository_id AS repo_id, COUNT(*) AS reviews
      FROM reviews r
      JOIN pull_requests pr ON pr.id = r.pull_request_id
      LEFT JOIN users u ON u.id = pr.author_id
      WHERE r.github_submitted_at BETWEEN $1 AND $2
        AND ${DEPENDABOT_FILTER}
      GROUP BY pr.repository_id
    ),
     comment_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS comments
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.github_created_at BETWEEN $1 AND $2
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE c.github_created_at BETWEEN $1 AND $2
           AND ${DEPENDABOT_FILTER}
       ) AS combined
       GROUP BY repository_id
     ),
    combined AS (
      SELECT
        COALESCE(ic.repo_id, pc.repo_id, rc.repo_id, cc.repo_id) AS repository_id,
        COALESCE(ic.issues, 0) AS issues,
        COALESCE(pc.pull_requests, 0) AS pull_requests,
        COALESCE(rc.reviews, 0) AS reviews,
        COALESCE(cc.comments, 0) AS comments
      FROM issue_counts ic
      FULL OUTER JOIN pr_counts pc ON pc.repo_id = ic.repo_id
      FULL OUTER JOIN review_counts rc ON rc.repo_id = COALESCE(ic.repo_id, pc.repo_id)
      FULL OUTER JOIN comment_counts cc ON cc.repo_id = COALESCE(ic.repo_id, pc.repo_id, rc.repo_id)
    )
     SELECT
       repository_id,
       issues,
       pull_requests,
      reviews,
      comments,
       (issues + pull_requests + reviews + comments) AS total_events
     FROM combined
     WHERE repository_id IS NOT NULL${repoFilter}
     ORDER BY total_events DESC`,
    params,
  );

  return result.rows;
}

export async function fetchRepoComparison(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoComparisonRawRow[]> {
  const params: unknown[] = [start, end];
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
       WHERE github_closed_at BETWEEN $1 AND $2${repoFilterIssues}
       UNION
       SELECT DISTINCT repository_id
       FROM issues
       WHERE github_created_at BETWEEN $1 AND $2${repoFilterIssues}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_created_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.data -> 'mergedBy' ->> 'id'
       WHERE pr.github_merged_at BETWEEN $1 AND $2${repoFilterPr}
         AND pr.github_merged_at IS NOT NULL
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.github_submitted_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       UNION
       SELECT DISTINCT repo_id
       FROM (
         SELECT i.repository_id AS repo_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.github_created_at BETWEEN $1 AND $2${repoFilterIssues}
         UNION ALL
         SELECT p.repository_id AS repo_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE c.github_created_at BETWEEN $1 AND $2${repoFilterPr}
           AND ${DEPENDABOT_FILTER}
       ) comment_repo_ids
     ),
     issue_counts AS (
       SELECT repository_id, COUNT(*) AS issues_resolved
       FROM issues
       WHERE github_closed_at BETWEEN $1 AND $2${repoFilterIssues}
       GROUP BY repository_id
     ),
     issue_created_counts AS (
       SELECT repository_id, COUNT(*) AS issues_created
       FROM issues
       WHERE github_created_at BETWEEN $1 AND $2${repoFilterIssues}
       GROUP BY repository_id
     ),
     pr_counts AS (
       SELECT pr.repository_id, COUNT(*) AS prs_merged
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at BETWEEN $1 AND $2${repoFilterPr}
        AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
    ),
    pr_created_counts AS (
      SELECT pr.repository_id, COUNT(*) AS prs_created
      FROM pull_requests pr
      LEFT JOIN users u ON u.id = pr.author_id
      WHERE pr.github_created_at BETWEEN $1 AND $2${repoFilterPr}
       AND ${DEPENDABOT_FILTER}
      GROUP BY pr.repository_id
    ),
    pr_merged_by_counts AS (
      SELECT pr.repository_id, COUNT(*) AS prs_merged_by
      FROM pull_requests pr
      LEFT JOIN users u ON u.id = pr.data -> 'mergedBy' ->> 'id'
      WHERE pr.github_merged_at BETWEEN $1 AND $2${repoFilterPr}
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
       WHERE r.github_submitted_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
     comment_counts AS (
       SELECT repository_id, COUNT(*) AS comments
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.github_created_at BETWEEN $1 AND $2${repoFilterIssues}
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE c.github_created_at BETWEEN $1 AND $2${repoFilterPr}
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
       WHERE pr.github_created_at BETWEEN $1 AND $2${repoFilterPr}
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
