import {
  averageBusinessResponseHours,
  DEPENDABOT_FILTER,
  HOLIDAY_SET,
} from "@/lib/dashboard/analytics/shared";
import type { HeatmapCell } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";

type ReviewAggregateRow = {
  reviews_completed: number;
  avg_response_hours: number | null;
  avg_participation: number | null;
};

type ReviewStatsRow = {
  reviews_completed: number;
  avg_participation: number | null;
};

type ReviewResponseRow = {
  reviewer_id: string | null;
  pull_request_id: string;
  requested_at: string;
  responded_at: string | null;
};

type HeatmapRow = {
  dow: number;
  hour: number;
  count: number;
};

export async function fetchReviewAggregates(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<ReviewAggregateRow> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const [statsResult, responseRows] = await Promise.all([
    query<ReviewStatsRow>(
      `WITH pr_scope AS (
         SELECT pr.id, pr.github_created_at, pr.github_merged_at, pr.repository_id, pr.author_id
         FROM pull_requests pr
         LEFT JOIN users u ON u.id = pr.author_id
         WHERE pr.github_merged_at BETWEEN $1 AND $2${repoClause}
           AND pr.github_merged_at IS NOT NULL
           AND ${DEPENDABOT_FILTER}
       ),
       reviews_in_range AS (
         SELECT r.id, r.author_id, r.github_submitted_at, r.pull_request_id
         FROM reviews r
         JOIN pr_scope pr ON pr.id = r.pull_request_id
         WHERE r.github_submitted_at BETWEEN $1 AND $2
       ),
       participation AS (
         SELECT
           pr_scope.id AS pull_request_id,
           COUNT(DISTINCT r.author_id)
             FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS reviewer_count
         FROM pr_scope
         LEFT JOIN reviews r ON r.pull_request_id = pr_scope.id
         GROUP BY pr_scope.id
       )
       SELECT
         (SELECT COUNT(*) FROM reviews_in_range) AS reviews_completed,
         (SELECT AVG(COALESCE(participation.reviewer_count, 0)) FROM participation) AS avg_participation
       `,
      params,
    ),
    fetchReviewResponsePairs(start, end, repositoryIds),
  ]);

  const statsRow = statsResult.rows[0] ?? {
    reviews_completed: 0,
    avg_participation: null,
  };

  const avgResponseHours = averageBusinessResponseHours(
    responseRows.map((row) => ({
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
    })),
    HOLIDAY_SET,
  );

  return {
    reviews_completed: Number(statsRow.reviews_completed ?? 0),
    avg_response_hours: avgResponseHours,
    avg_participation: statsRow.avg_participation,
  };
}

export async function fetchReviewHeatmap(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<HeatmapCell[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const result = await query<HeatmapRow>(
    `SELECT
       EXTRACT(DOW FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
       EXTRACT(HOUR FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
       COUNT(*)
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     WHERE r.github_submitted_at BETWEEN $1 AND $2${repoClause}
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

export async function fetchReviewResponsePairs(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  reviewerId?: string,
): Promise<ReviewResponseRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  let reviewerClause = "";
  if (reviewerId) {
    params.push(reviewerId);
    reviewerClause = ` AND rr.reviewer_id = $${params.length}`;
  }

  const result = await query<ReviewResponseRow>(
    `WITH pr_scope AS (
       SELECT pr.id, pr.github_created_at, pr.repository_id, pr.author_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_created_at BETWEEN $1 AND $2${repoClause}
         AND ${DEPENDABOT_FILTER}
     ),
     review_requests_scope AS (
       SELECT rr.id, rr.pull_request_id, rr.reviewer_id, rr.requested_at, rr.removed_at
       FROM review_requests rr
       JOIN pr_scope pr ON pr.id = rr.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE rr.reviewer_id IS NOT NULL
         AND rr.requested_at BETWEEN $1 AND $2${reviewerClause}
         AND pr.author_id <> rr.reviewer_id
         AND ${DEPENDABOT_FILTER}
     ),
     response_events AS (
       SELECT
         rr.id AS review_request_id,
         r.github_submitted_at AS responded_at
       FROM review_requests_scope rr
       JOIN reviews r ON r.pull_request_id = rr.pull_request_id
       WHERE r.author_id = rr.reviewer_id
         AND r.github_submitted_at BETWEEN $1 AND $2
       UNION ALL
       SELECT
         rr.id AS review_request_id,
         c.github_created_at AS responded_at
       FROM review_requests_scope rr
       JOIN comments c ON c.pull_request_id = rr.pull_request_id
       WHERE c.author_id = rr.reviewer_id
         AND c.github_created_at BETWEEN $1 AND $2
       UNION ALL
       SELECT
         rr.id AS review_request_id,
         r.github_created_at AS responded_at
       FROM review_requests_scope rr
       JOIN reactions r ON r.subject_id = rr.pull_request_id
       WHERE r.subject_type = 'pull_request'
         AND r.user_id = rr.reviewer_id
         AND r.github_created_at BETWEEN $1 AND $2
     ),
     valid_responses AS (
       SELECT
         rr.id AS review_request_id,
         MIN(response_events.responded_at) AS responded_at
       FROM review_requests_scope rr
       LEFT JOIN response_events
         ON response_events.review_request_id = rr.id
         AND response_events.responded_at >= rr.requested_at
         AND (rr.removed_at IS NULL OR response_events.responded_at < rr.removed_at)
       GROUP BY rr.id
     )
     SELECT
       rr.reviewer_id,
       rr.pull_request_id,
       rr.requested_at,
       valid_responses.responded_at
     FROM review_requests_scope rr
     JOIN valid_responses ON valid_responses.review_request_id = rr.id
     WHERE valid_responses.responded_at IS NOT NULL`,
    params,
  );

  return result.rows;
}
