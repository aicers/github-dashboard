import {
  DEPENDABOT_FILTER,
  formatDateKey,
} from "@/lib/dashboard/analytics/shared";
import type { TrendPoint } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";

export type TotalEventsRow = {
  total_events: number;
  issues: number;
  pull_requests: number;
  reviews: number;
  comments: number;
};

type TrendRow = {
  date: Date | string;
  count: number | string;
};

export async function fetchTotalEvents(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<TotalEventsRow> {
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
    repoClausePrs = ` AND p.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsIssue = ` AND ic.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsPr = ` AND pc.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<TotalEventsRow>(
    `WITH issue_events AS (
       SELECT COUNT(*) AS issues
       FROM issues i
       WHERE i.github_created_at BETWEEN $1 AND $2${repoClauseIssues}
     ),
     pr_events AS (
       SELECT COUNT(*) AS pull_requests
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.github_created_at BETWEEN $1 AND $2${repoClausePrs}
         AND ${DEPENDABOT_FILTER}
     ),
     review_events AS (
       SELECT COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.github_submitted_at BETWEEN $1 AND $2${repoClauseReviews}
         AND ${DEPENDABOT_FILTER}
     ),
     comment_events AS (
       SELECT COUNT(*) AS comments
       FROM comments c
       LEFT JOIN LATERAL (
         SELECT i.repository_id FROM issues i WHERE i.id = c.issue_id
       ) ic ON TRUE
       LEFT JOIN LATERAL (
         SELECT p.repository_id FROM pull_requests p WHERE p.id = c.pull_request_id
       ) pc ON TRUE
       WHERE c.github_created_at BETWEEN $1 AND $2
         AND (
           (c.issue_id IS NOT NULL${repoClauseCommentsIssue})
           OR (c.pull_request_id IS NOT NULL${repoClauseCommentsPr})
         )
     )
     SELECT
       issue_events.issues + pr_events.pull_requests + review_events.reviews + comment_events.comments AS total_events,
       issue_events.issues,
       pr_events.pull_requests,
       review_events.reviews,
       comment_events.comments
     FROM issue_events, pr_events, review_events, comment_events`,
    params,
  );

  return (
    result.rows[0] ?? {
      total_events: 0,
      issues: 0,
      pull_requests: 0,
      reviews: 0,
      comments: 0,
    }
  );
}

export async function fetchTrend(
  table: "issues" | "pull_requests",
  column: "github_created_at" | "github_closed_at" | "github_merged_at",
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<TrendPoint[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  const alias = table === "issues" ? "i" : "p";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND ${alias}.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const queryText = `SELECT to_char(date_trunc('day', ${alias}.${column} AT TIME ZONE $${timezoneIndex}), 'YYYY-MM-DD') AS date, COUNT(*)
    FROM ${table} ${alias}
    WHERE ${alias}.${column} BETWEEN $1 AND $2${repoClause}
    GROUP BY date
    ORDER BY date`;

  params.push(timeZone);
  const result = await query<TrendRow>(queryText, params);
  return result.rows.map((row) => {
    let normalizedDate: string | null = null;
    if (row.date instanceof Date) {
      normalizedDate = formatDateKey(row.date);
    } else if (typeof row.date === "string") {
      normalizedDate = row.date;
    }

    return {
      date: normalizedDate ?? String(row.date),
      value: Number(row.count ?? 0),
    };
  });
}
