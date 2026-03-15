import { refreshActivitySocialSignals } from "@/lib/activity/social-signals";
import { query, withTransaction } from "@/lib/db/client";

import {
  buildStoredUserData,
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbPullRequestIssueLink,
  type DbReaction,
  type DbRepository,
  type DbReview,
  type DbReviewRequest,
  parseStoredUserData,
  type StoredUserProfile,
  toJsonb,
} from "./types";

export async function upsertUser(actor: DbActor | null) {
  if (!actor?.id) {
    return;
  }

  const existing = await query<{
    avatar_url: string | null;
    data: unknown;
  }>(`SELECT avatar_url, data FROM users WHERE id = $1`, [actor.id]);

  const parsed = parseStoredUserData(existing.rows[0]?.data);
  const existingProfile = parsed.profile;

  const nextProfile: StoredUserProfile = {
    originalAvatarUrl:
      actor.avatarUrl ?? existingProfile.originalAvatarUrl ?? null,
    customAvatarUrl: existingProfile.customAvatarUrl,
  };

  const nextData = buildStoredUserData(actor, nextProfile, parsed.raw);

  const nextAvatarUrl = nextProfile.customAvatarUrl ?? actor.avatarUrl ?? null;

  await query(
    `INSERT INTO users (id, login, name, avatar_url, github_created_at, github_updated_at, data, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       login = EXCLUDED.login,
       name = EXCLUDED.name,
       avatar_url = EXCLUDED.avatar_url,
       github_created_at = COALESCE(EXCLUDED.github_created_at, users.github_created_at),
       github_updated_at = COALESCE(EXCLUDED.github_updated_at, users.github_updated_at),
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      actor.id,
      actor.login ?? actor.name ?? null,
      actor.name ?? actor.login ?? null,
      nextAvatarUrl,
      actor.createdAt ?? null,
      actor.updatedAt ?? null,
      JSON.stringify(nextData),
    ],
  );
}

export async function upsertRepository(repository: DbRepository) {
  await query(
    `INSERT INTO repositories (
       id,
       name,
       name_with_owner,
       owner_id,
       url,
       is_private,
       github_created_at,
       github_updated_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       name_with_owner = EXCLUDED.name_with_owner,
       owner_id = EXCLUDED.owner_id,
       url = EXCLUDED.url,
       is_private = EXCLUDED.is_private,
       github_created_at = EXCLUDED.github_created_at,
       github_updated_at = EXCLUDED.github_updated_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      repository.id,
      repository.name,
      repository.nameWithOwner,
      repository.ownerId ?? null,
      repository.url ?? null,
      repository.isPrivate ?? null,
      repository.createdAt ?? null,
      repository.updatedAt ?? null,
      toJsonb(repository.raw),
    ],
  );
}

export async function upsertIssue(issue: DbIssue) {
  await query(
    `INSERT INTO issues (
       id,
       number,
       repository_id,
       author_id,
       title,
       state,
       github_created_at,
       github_updated_at,
       github_closed_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       number = EXCLUDED.number,
       repository_id = EXCLUDED.repository_id,
       author_id = EXCLUDED.author_id,
       title = EXCLUDED.title,
       state = EXCLUDED.state,
       github_created_at = EXCLUDED.github_created_at,
       github_updated_at = EXCLUDED.github_updated_at,
       github_closed_at = EXCLUDED.github_closed_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      issue.id,
      issue.number,
      issue.repositoryId,
      issue.authorId ?? null,
      issue.title ?? null,
      issue.state ?? null,
      issue.createdAt,
      issue.updatedAt,
      issue.closedAt ?? null,
      toJsonb(issue.raw),
    ],
  );
}

export async function fetchIssueRawMap(ids: readonly string[]) {
  if (!ids.length) {
    return new Map<string, unknown>();
  }

  const result = await query<{ id: string; data: unknown }>(
    `SELECT id, data
       FROM issues
      WHERE id = ANY($1::text[])`,
    [ids],
  );

  const map = new Map<string, unknown>();
  for (const row of result.rows) {
    map.set(row.id, row.data);
  }

  return map;
}

export async function upsertPullRequest(pullRequest: DbPullRequest) {
  await query(
    `INSERT INTO pull_requests (
       id,
       number,
       repository_id,
       author_id,
       title,
       state,
       merged,
       github_created_at,
       github_updated_at,
       github_closed_at,
       github_merged_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       number = EXCLUDED.number,
       repository_id = EXCLUDED.repository_id,
       author_id = EXCLUDED.author_id,
       title = EXCLUDED.title,
       state = EXCLUDED.state,
       merged = EXCLUDED.merged,
       github_created_at = EXCLUDED.github_created_at,
       github_updated_at = EXCLUDED.github_updated_at,
       github_closed_at = EXCLUDED.github_closed_at,
       github_merged_at = EXCLUDED.github_merged_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      pullRequest.id,
      pullRequest.number,
      pullRequest.repositoryId,
      pullRequest.authorId ?? null,
      pullRequest.title ?? null,
      pullRequest.state ?? null,
      pullRequest.merged ?? null,
      pullRequest.createdAt,
      pullRequest.updatedAt,
      pullRequest.closedAt ?? null,
      pullRequest.mergedAt ?? null,
      toJsonb(pullRequest.raw),
    ],
  );
}

export async function replacePullRequestIssues(
  pullRequestId: string,
  issues: readonly DbPullRequestIssueLink[],
) {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM pull_request_issues WHERE pull_request_id = $1`,
      [pullRequestId],
    );

    if (!issues.length) {
      return;
    }

    for (const issue of issues) {
      await client.query(
        `INSERT INTO pull_request_issues (
           pull_request_id,
           issue_id,
           issue_number,
           issue_title,
           issue_state,
           issue_url,
           issue_repository,
           inserted_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (pull_request_id, issue_id) DO UPDATE SET
           issue_number = EXCLUDED.issue_number,
           issue_title = EXCLUDED.issue_title,
           issue_state = EXCLUDED.issue_state,
           issue_url = EXCLUDED.issue_url,
           issue_repository = EXCLUDED.issue_repository,
           updated_at = NOW()`,
        [
          pullRequestId,
          issue.issueId,
          issue.issueNumber ?? null,
          issue.issueTitle ?? null,
          issue.issueState ?? null,
          issue.issueUrl ?? null,
          issue.issueRepository ?? null,
        ],
      );
    }
  });
}

export async function upsertReaction(reaction: DbReaction) {
  await query(
    `INSERT INTO reactions (
       id,
       subject_type,
       subject_id,
       user_id,
       content,
       github_created_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       subject_type = EXCLUDED.subject_type,
       subject_id = EXCLUDED.subject_id,
       user_id = EXCLUDED.user_id,
       content = EXCLUDED.content,
       github_created_at = EXCLUDED.github_created_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      reaction.id,
      reaction.subjectType,
      reaction.subjectId,
      reaction.userId ?? null,
      reaction.content ?? null,
      reaction.createdAt ?? null,
      toJsonb(reaction.raw),
    ],
  );

  const normalizedType =
    typeof reaction.subjectType === "string"
      ? reaction.subjectType.trim().toLowerCase()
      : "";

  if (normalizedType === "issue" || normalizedType === "discussion") {
    await refreshActivitySocialSignals({
      issueIds: [reaction.subjectId],
    });
  } else if (
    normalizedType === "pullrequest" ||
    normalizedType === "pull_request"
  ) {
    await refreshActivitySocialSignals({
      pullRequestIds: [reaction.subjectId],
    });
  }
}

export async function upsertReviewRequest(request: DbReviewRequest) {
  await query(
    `INSERT INTO review_requests (
       id,
       pull_request_id,
       reviewer_id,
       requested_at,
       removed_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NULL, $5::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       pull_request_id = EXCLUDED.pull_request_id,
       reviewer_id = EXCLUDED.reviewer_id,
       requested_at = EXCLUDED.requested_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      request.id,
      request.pullRequestId,
      request.reviewerId ?? null,
      request.requestedAt,
      toJsonb(request.raw),
    ],
  );
}

export async function upsertReview(review: DbReview) {
  await query(
    `INSERT INTO reviews (
       id,
       pull_request_id,
       author_id,
       state,
       github_submitted_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       pull_request_id = EXCLUDED.pull_request_id,
       author_id = EXCLUDED.author_id,
       state = EXCLUDED.state,
       github_submitted_at = EXCLUDED.github_submitted_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      review.id,
      review.pullRequestId,
      review.authorId ?? null,
      review.state ?? null,
      review.submittedAt ?? null,
      toJsonb(review.raw),
    ],
  );
}

export async function updateIssueAssignees(
  issueId: string,
  assignees: unknown,
) {
  await query(
    `UPDATE issues
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{assignees}', $2::jsonb, true),
         updated_at = NOW()
     WHERE id = $1`,
    [issueId, toJsonb(assignees ?? null)],
  );
}

export async function updatePullRequestAssignees(
  pullRequestId: string,
  assignees: unknown,
) {
  await query(
    `UPDATE pull_requests
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{assignees}', $2::jsonb, true),
         updated_at = NOW()
     WHERE id = $1`,
    [pullRequestId, toJsonb(assignees ?? null)],
  );
}

export async function reviewExists(reviewId: string) {
  const result = await query(`SELECT 1 FROM reviews WHERE id = $1`, [reviewId]);
  return Boolean(result.rowCount && result.rowCount > 0);
}

export async function upsertComment(comment: DbComment) {
  await query(
    `INSERT INTO comments (
       id,
       issue_id,
       pull_request_id,
       review_id,
       author_id,
       github_created_at,
       github_updated_at,
       data,
       inserted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       issue_id = COALESCE(EXCLUDED.issue_id, comments.issue_id),
       pull_request_id = COALESCE(EXCLUDED.pull_request_id, comments.pull_request_id),
       review_id = COALESCE(EXCLUDED.review_id, comments.review_id),
       author_id = EXCLUDED.author_id,
       github_created_at = EXCLUDED.github_created_at,
       github_updated_at = EXCLUDED.github_updated_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      comment.id,
      comment.issueId ?? null,
      comment.pullRequestId ?? null,
      comment.reviewId ?? null,
      comment.authorId ?? null,
      comment.createdAt,
      comment.updatedAt ?? null,
      toJsonb(comment.raw),
    ],
  );

  if (comment.issueId || comment.pullRequestId) {
    await refreshActivitySocialSignals({
      issueIds: comment.issueId ? [comment.issueId] : undefined,
      pullRequestIds: comment.pullRequestId
        ? [comment.pullRequestId]
        : undefined,
    });
  }
}
