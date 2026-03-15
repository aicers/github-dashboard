import { refreshActivitySocialSignals } from "@/lib/activity/social-signals";
import { query } from "@/lib/db/client";

import { type PendingReviewRequest, toJsonb } from "./types";

export async function deleteReactionsForSubject({
  subjectType,
  subjectId,
  keepIds,
}: {
  subjectType: string;
  subjectId: string;
  keepIds: readonly string[];
}) {
  await query(
    `DELETE FROM reactions
       WHERE subject_type = $1
         AND subject_id = $2
         AND NOT (id = ANY($3::text[]))`,
    [subjectType, subjectId, keepIds],
  );
}

export async function listCommentIdsByPullRequestIds(
  pullRequestIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (!pullRequestIds.length) {
    return new Map();
  }

  const result = await query<{
    id: string;
    pull_request_id: string | null;
  }>(
    `SELECT id, pull_request_id
     FROM comments
     WHERE pull_request_id = ANY($1::text[])`,
    [pullRequestIds],
  );

  const map = new Map<string, string[]>();
  result.rows.forEach((row) => {
    const pullRequestId = row.pull_request_id;
    if (!pullRequestId) {
      return;
    }
    const list = map.get(pullRequestId);
    if (list) {
      list.push(row.id);
    } else {
      map.set(pullRequestId, [row.id]);
    }
  });

  return map;
}

export async function listReviewIdsByPullRequestIds(
  pullRequestIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (!pullRequestIds.length) {
    return new Map();
  }

  const result = await query<{
    id: string;
    pull_request_id: string | null;
  }>(
    `SELECT id, pull_request_id
     FROM reviews
     WHERE pull_request_id = ANY($1::text[])`,
    [pullRequestIds],
  );

  const map = new Map<string, string[]>();
  result.rows.forEach((row) => {
    const pullRequestId = row.pull_request_id;
    if (!pullRequestId) {
      return;
    }
    const list = map.get(pullRequestId);
    if (list) {
      list.push(row.id);
    } else {
      map.set(pullRequestId, [row.id]);
    }
  });

  return map;
}

export async function listPendingReviewRequestsByPullRequestIds(
  pullRequestIds: readonly string[],
): Promise<Map<string, PendingReviewRequest[]>> {
  if (!pullRequestIds.length) {
    return new Map();
  }

  const result = await query<{
    id: string;
    pull_request_id: string | null;
    reviewer_id: string | null;
    requested_at: string;
  }>(
    `SELECT id, pull_request_id, reviewer_id, requested_at
       FROM review_requests
       WHERE removed_at IS NULL
         AND pull_request_id = ANY($1::text[])`,
    [pullRequestIds],
  );

  const map = new Map<string, PendingReviewRequest[]>();
  result.rows.forEach((row) => {
    if (!row.pull_request_id) {
      return;
    }
    const list = map.get(row.pull_request_id) ?? [];
    list.push({
      id: row.id,
      pullRequestId: row.pull_request_id,
      reviewerId: row.reviewer_id ?? null,
      requestedAt: row.requested_at,
    });
    map.set(row.pull_request_id, list);
  });

  return map;
}

export async function listExistingPullRequestIds(
  pullRequestIds: readonly string[],
): Promise<Set<string>> {
  if (!pullRequestIds.length) {
    return new Set<string>();
  }

  const result = await query<{ id: string }>(
    `SELECT id
       FROM pull_requests
      WHERE id = ANY($1::text[])`,
    [pullRequestIds],
  );

  return new Set(result.rows.map((row) => row.id));
}

export async function markReviewRequestRemoved(params: {
  pullRequestId: string;
  reviewerId: string | null;
  removedAt: string;
  raw: unknown;
}) {
  const { pullRequestId, reviewerId, removedAt, raw } = params;
  if (!reviewerId) {
    return;
  }

  await query(
    `WITH target AS (
       SELECT id
       FROM review_requests
       WHERE pull_request_id = $1
         AND reviewer_id = $2
         AND requested_at <= $3
         AND (removed_at IS NULL OR removed_at > $3)
       ORDER BY requested_at DESC
       LIMIT 1
     )
     UPDATE review_requests
     SET removed_at = $3,
         removed_data = $4::jsonb,
         updated_at = NOW()
     WHERE id IN (SELECT id FROM target)`,
    [pullRequestId, reviewerId, removedAt, toJsonb(raw)],
  );
}

const COMMENT_REACTION_TYPES = [
  "issuecomment",
  "pullrequestreviewcomment",
  "discussioncomment",
  "teamdiscussioncomment",
  "commitcomment",
  "comment",
];

type DeletedCommentRow = {
  id: string;
  issue_id: string | null;
  pull_request_id: string | null;
};

async function applyCommentDeletionSideEffects(rows: DeletedCommentRow[]) {
  if (!rows.length) {
    return;
  }

  const deletedIds = rows.map((row) => row.id);
  await query(
    `DELETE FROM reactions
       WHERE subject_id = ANY($1::text[])
         AND LOWER(subject_type) = ANY($2::text[])`,
    [deletedIds, COMMENT_REACTION_TYPES],
  );

  const issueIds = new Set<string>();
  const pullRequestIds = new Set<string>();
  rows.forEach((row) => {
    if (row.issue_id) {
      issueIds.add(row.issue_id);
    }
    if (row.pull_request_id) {
      pullRequestIds.add(row.pull_request_id);
    }
  });

  if (issueIds.size || pullRequestIds.size) {
    await refreshActivitySocialSignals({
      issueIds: issueIds.size ? Array.from(issueIds) : undefined,
      pullRequestIds: pullRequestIds.size
        ? Array.from(pullRequestIds)
        : undefined,
    });
  }
}

export async function deleteMissingCommentsForTarget(options: {
  issueId?: string | null;
  pullRequestId?: string | null;
  since?: string | null;
  until?: string | null;
  keepIds: readonly string[];
  scope?: "any" | "review_only" | "non_review";
}) {
  const {
    issueId = null,
    pullRequestId = null,
    since = null,
    until = null,
    keepIds,
    scope = "any",
  } = options;

  if (!issueId && !pullRequestId) {
    return 0;
  }

  const values: unknown[] = [];
  const clauses: string[] = [];

  if (issueId) {
    values.push(issueId);
    clauses.push(`issue_id = $${values.length}`);
  }

  if (pullRequestId) {
    values.push(pullRequestId);
    clauses.push(`pull_request_id = $${values.length}`);
  }

  const timestampClause =
    "COALESCE(github_updated_at, github_created_at, NOW())";
  if (since) {
    values.push(since);
    clauses.push(`${timestampClause} >= $${values.length}`);
  }
  if (until) {
    values.push(until);
    clauses.push(`${timestampClause} < $${values.length}`);
  }

  if (scope === "review_only") {
    clauses.push("review_id IS NOT NULL");
  } else if (scope === "non_review") {
    clauses.push("review_id IS NULL");
  }

  values.push(keepIds);
  const keepIndex = values.length;
  clauses.push(`NOT (id = ANY($${keepIndex}::text[]))`);

  const whereClause = clauses.length ? clauses.join(" AND ") : "TRUE";

  const deleteResult = await query<DeletedCommentRow>(
    `DELETE FROM comments
      WHERE ${whereClause}
      RETURNING id, issue_id, pull_request_id`,
    values,
  );

  if (!deleteResult.rowCount) {
    return 0;
  }

  await applyCommentDeletionSideEffects(deleteResult.rows);

  return deleteResult.rowCount;
}

export async function deleteCommentsByIds(ids: readonly string[]) {
  if (!ids.length) {
    return 0;
  }

  const result = await query<DeletedCommentRow>(
    `DELETE FROM comments
       WHERE id = ANY($1::text[])
       RETURNING id, issue_id, pull_request_id`,
    [ids],
  );

  if (!result.rowCount) {
    return 0;
  }

  await applyCommentDeletionSideEffects(result.rows);

  return result.rowCount;
}
