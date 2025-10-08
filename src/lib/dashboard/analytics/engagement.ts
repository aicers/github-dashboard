import { DEPENDABOT_FILTER } from "@/lib/dashboard/analytics/shared";
import { query } from "@/lib/db/client";

export type ReviewerActivityRow = {
  reviewer_id: string;
  review_count: number;
  prs_reviewed: number;
  active_review_count: number;
};

export type MainBranchContributionRow = {
  user_id: string;
  review_count: number;
  active_review_count: number;
  author_count: number;
  additions: number;
  deletions: number;
  active_additions: number;
  active_deletions: number;
};

export async function fetchReviewerActivity(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  limit?: number,
): Promise<ReviewerActivityRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  let limitClause = "";
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    params.push(limit);
    limitClause = ` LIMIT $${params.length}`;
  }

  const result = await query<ReviewerActivityRow>(
    `SELECT
       r.author_id AS reviewer_id,
       COUNT(*) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS review_count,
       COUNT(DISTINCT r.pull_request_id) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS prs_reviewed,
       COUNT(DISTINCT r.pull_request_id) FILTER (
        WHERE r.github_submitted_at BETWEEN $1 AND $2 AND r.state = 'APPROVED'
      ) AS active_review_count
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     LEFT JOIN users u ON u.id = pr.author_id
     WHERE r.author_id IS NOT NULL${repoClause}
       AND COALESCE(r.state, '') <> 'DISMISSED'
       AND ${DEPENDABOT_FILTER}
     GROUP BY r.author_id
     ORDER BY review_count DESC, prs_reviewed DESC${limitClause}`,
    params,
  );

  return result.rows;
}

export async function fetchMainBranchContribution(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<MainBranchContributionRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND p.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<MainBranchContributionRow>(
    `WITH merged_prs AS (
       SELECT
         p.id,
         p.author_id,
         COALESCE((p.data ->> 'additions')::numeric, 0) AS additions,
         COALESCE((p.data ->> 'deletions')::numeric, 0) AS deletions
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.github_merged_at BETWEEN $1 AND $2
         AND p.github_merged_at IS NOT NULL${repoClause}
         AND ${DEPENDABOT_FILTER}
     ),
     author_contrib AS (
       SELECT
         mp.author_id AS user_id,
         COUNT(*) AS author_count,
         SUM(mp.additions) AS additions,
         SUM(mp.deletions) AS deletions
       FROM merged_prs mp
       WHERE mp.author_id IS NOT NULL
       GROUP BY mp.author_id
     ),
    review_prs AS (
      SELECT
        r.author_id AS reviewer_id,
        mp.id,
        mp.additions,
        mp.deletions,
        BOOL_OR(r.state = 'APPROVED') AS has_approved
      FROM merged_prs mp
      JOIN reviews r ON r.pull_request_id = mp.id
      LEFT JOIN users u ON u.id = r.author_id
      WHERE r.author_id IS NOT NULL
        AND ${DEPENDABOT_FILTER}
        AND r.github_submitted_at BETWEEN $1 AND $2
        AND COALESCE(r.state, '') <> 'DISMISSED'
        AND r.author_id <> mp.author_id
      GROUP BY r.author_id, mp.id, mp.additions, mp.deletions
    ),
    review_contrib AS (
      SELECT
        reviewer_id AS user_id,
        COUNT(*) AS review_count,
        SUM(CASE WHEN has_approved THEN 1 ELSE 0 END) AS active_review_count,
        SUM(additions) AS additions,
        SUM(deletions) AS deletions,
        SUM(CASE WHEN has_approved THEN additions ELSE 0 END) AS active_additions,
        SUM(CASE WHEN has_approved THEN deletions ELSE 0 END) AS active_deletions
      FROM review_prs
      GROUP BY reviewer_id
    )
    SELECT
      COALESCE(author_contrib.user_id, review_contrib.user_id) AS user_id,
      COALESCE(review_contrib.review_count, 0) AS review_count,
      COALESCE(review_contrib.active_review_count, 0) AS active_review_count,
      COALESCE(author_contrib.author_count, 0) AS author_count,
      COALESCE(author_contrib.additions, 0) + COALESCE(review_contrib.additions, 0) AS additions,
      COALESCE(author_contrib.deletions, 0) + COALESCE(review_contrib.deletions, 0) AS deletions,
      COALESCE(author_contrib.additions, 0) + COALESCE(review_contrib.active_additions, 0) AS active_additions,
      COALESCE(author_contrib.deletions, 0) + COALESCE(review_contrib.active_deletions, 0) AS active_deletions
    FROM author_contrib
    FULL OUTER JOIN review_contrib ON author_contrib.user_id = review_contrib.user_id
    WHERE COALESCE(author_contrib.author_count, 0) + COALESCE(review_contrib.review_count, 0) > 0
    ORDER BY (COALESCE(author_contrib.author_count, 0) + COALESCE(review_contrib.review_count, 0)) DESC,
             COALESCE(author_contrib.additions, 0) + COALESCE(review_contrib.additions, 0) DESC`,
    params,
  );

  return result.rows;
}

export async function fetchActiveContributors(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<string[]> {
  const params: unknown[] = [start, end];
  let repoClauseIssues = "";
  let repoClausePrs = "";
  let repoClauseReviews = "";
  let repoClauseCommentsIssue = "";
  let repoClauseCommentsPr = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePrs = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = repoClausePrs;
    repoClauseCommentsIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsPr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<{ user_id: string }>(
    `WITH issue_authors AS (
       SELECT DISTINCT i.author_id AS user_id
       FROM issues i
       WHERE i.author_id IS NOT NULL AND i.github_created_at BETWEEN $1 AND $2${repoClauseIssues}
     ),
     review_authors AS (
       SELECT DISTINCT r.author_id AS user_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       WHERE r.author_id IS NOT NULL AND r.github_submitted_at BETWEEN $1 AND $2${repoClauseReviews}
     ),
     comment_authors AS (
       SELECT DISTINCT c.author_id AS user_id
       FROM comments c
       LEFT JOIN issues i ON i.id = c.issue_id
       LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
       WHERE c.author_id IS NOT NULL AND c.github_created_at BETWEEN $1 AND $2
         AND (
           (c.issue_id IS NOT NULL${repoClauseCommentsIssue})
           OR (c.pull_request_id IS NOT NULL${repoClauseCommentsPr})
         )
     )
     SELECT DISTINCT user_id
     FROM (
       SELECT user_id FROM issue_authors
       UNION
       SELECT user_id FROM review_authors
       UNION
       SELECT user_id FROM comment_authors
     ) combined
     WHERE user_id IS NOT NULL`,
    params,
  );

  return result.rows.map((row) => row.user_id);
}
