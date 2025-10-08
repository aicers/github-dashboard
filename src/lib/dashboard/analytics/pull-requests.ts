import { query } from "@/lib/db/client";

type PrAggregateRow = {
  prs_created: number;
  prs_created_dependabot: number;
  prs_merged: number;
  prs_merged_dependabot: number;
  avg_merge_hours: number | null;
  merge_without_review: number;
  avg_lines_changed: number | null;
  avg_additions: number | null;
  avg_deletions: number | null;
  avg_comments_pr: number | null;
  avg_reviews_pr: number | null;
};

export async function fetchPrAggregates(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<PrAggregateRow> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND p.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<{
    prs_created_total: number | null;
    prs_created_dependabot: number | null;
    prs_merged_total: number | null;
    prs_merged_dependabot: number | null;
    avg_merge_hours: number | null;
    merge_without_review: number | null;
    avg_lines_changed: number | null;
    avg_additions: number | null;
    avg_deletions: number | null;
    avg_comments_pr: number | null;
    avg_reviews_pr: number | null;
  }>(
    `WITH review_counts AS (
       SELECT r.pull_request_id, COUNT(*) FILTER (WHERE r.github_submitted_at IS NOT NULL) AS review_count
       FROM reviews r
       GROUP BY r.pull_request_id
     ),
     pull_requests_with_flags AS (
       SELECT
         p.*,
         CASE
           WHEN u.login IS NULL THEN FALSE
           ELSE (
             LOWER(u.login) LIKE 'dependabot%'
             OR LOWER(u.login) = 'app/dependabot'
           )
         END AS is_dependabot
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
     )
      SELECT
       COUNT(*) FILTER (WHERE p.github_created_at BETWEEN $1 AND $2) AS prs_created_total,
       COUNT(*) FILTER (
         WHERE p.github_created_at BETWEEN $1 AND $2 AND p.is_dependabot
       ) AS prs_created_dependabot,
       COUNT(*) FILTER (WHERE p.github_merged_at BETWEEN $1 AND $2) AS prs_merged_total,
       COUNT(*) FILTER (
         WHERE p.github_merged_at BETWEEN $1 AND $2 AND p.is_dependabot
       ) AS prs_merged_dependabot,
       AVG(EXTRACT(EPOCH FROM (p.github_merged_at - p.github_created_at)) / 3600.0)
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND p.github_merged_at IS NOT NULL
             AND NOT p.is_dependabot
         ) AS avg_merge_hours,
       COUNT(*) FILTER (
         WHERE p.github_merged_at BETWEEN $1 AND $2
           AND COALESCE(rc.review_count, 0) = 0
           AND NOT p.is_dependabot
       ) AS merge_without_review,
       AVG(COALESCE((p.data ->> 'additions')::numeric, 0) + COALESCE((p.data ->> 'deletions')::numeric, 0))
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND NOT p.is_dependabot
        ) AS avg_lines_changed,
       AVG(COALESCE((p.data ->> 'additions')::numeric, 0))
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND p.github_merged_at IS NOT NULL
             AND NOT p.is_dependabot
         ) AS avg_additions,
       AVG(COALESCE((p.data ->> 'deletions')::numeric, 0))
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND p.github_merged_at IS NOT NULL
             AND NOT p.is_dependabot
         ) AS avg_deletions,
       AVG(COALESCE((p.data -> 'comments' ->> 'totalCount')::numeric, 0))
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND p.github_merged_at IS NOT NULL
             AND NOT p.is_dependabot
        ) AS avg_comments_pr,
       AVG(COALESCE(rc.review_count, 0))
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND p.github_merged_at IS NOT NULL
             AND NOT p.is_dependabot
        ) AS avg_reviews_pr
     FROM pull_requests_with_flags p
     LEFT JOIN review_counts rc ON rc.pull_request_id = p.id
     WHERE (p.github_created_at BETWEEN $1 AND $2
        OR p.github_merged_at BETWEEN $1 AND $2)${repoClause}`,
    params,
  );

  const row = result.rows[0];

  if (!row) {
    return {
      prs_created: 0,
      prs_created_dependabot: 0,
      prs_merged: 0,
      prs_merged_dependabot: 0,
      avg_merge_hours: null,
      merge_without_review: 0,
      avg_lines_changed: null,
      avg_additions: null,
      avg_deletions: null,
      avg_comments_pr: null,
      avg_reviews_pr: null,
    };
  }

  const createdTotal = Number(row.prs_created_total ?? 0);
  const createdDependabot = Number(row.prs_created_dependabot ?? 0);
  const mergedTotal = Number(row.prs_merged_total ?? 0);
  const mergedDependabot = Number(row.prs_merged_dependabot ?? 0);

  return {
    prs_created: createdTotal - createdDependabot,
    prs_created_dependabot: createdDependabot,
    prs_merged: mergedTotal - mergedDependabot,
    prs_merged_dependabot: mergedDependabot,
    avg_merge_hours: row.avg_merge_hours,
    merge_without_review: Number(row.merge_without_review ?? 0),
    avg_lines_changed: row.avg_lines_changed,
    avg_additions: row.avg_additions,
    avg_deletions: row.avg_deletions,
    avg_comments_pr: row.avg_comments_pr,
    avg_reviews_pr: row.avg_reviews_pr,
  };
}
