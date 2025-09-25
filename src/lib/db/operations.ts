import { query } from "@/lib/db/client";

type TableCountKey = "issues" | "pull_requests" | "reviews" | "comments";

export type TableCountSummary = {
  type: TableCountKey;
  count: number;
};

export type RangeSummary = {
  oldest: string | null;
  newest: string | null;
};

export type UserProfile = {
  id: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type RepositoryProfile = {
  id: string;
  name: string | null;
  nameWithOwner: string | null;
};

export type TopUserIssueSummary = {
  authorId: string;
  issueCount: number;
  profile: UserProfile | null;
};

export type TopRepositoryActivitySummary = {
  repositoryId: string;
  issueCount: number;
  pullRequestCount: number;
  repository: RepositoryProfile | null;
};

export type DashboardSummary = {
  counts: TableCountSummary[];
  issuesRange: RangeSummary;
  pullRequestsRange: RangeSummary;
  topUsers: TopUserIssueSummary[];
  topRepositories: TopRepositoryActivitySummary[];
};

export type DbActor = {
  id: string;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  __typename?: string;
};

export type DbRepository = {
  id: string;
  name: string;
  nameWithOwner: string;
  url?: string | null;
  isPrivate?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerId?: string | null;
  raw: unknown;
};

export type DbIssue = {
  id: string;
  number: number;
  repositoryId: string;
  authorId?: string | null;
  title?: string | null;
  state?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  raw: unknown;
};

export type DbPullRequest = {
  id: string;
  number: number;
  repositoryId: string;
  authorId?: string | null;
  title?: string | null;
  state?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  merged?: boolean | null;
  raw: unknown;
};

export type DbReview = {
  id: string;
  pullRequestId: string;
  authorId?: string | null;
  state?: string | null;
  submittedAt?: string | null;
  raw: unknown;
};

export type DbComment = {
  id: string;
  issueId?: string | null;
  pullRequestId?: string | null;
  reviewId?: string | null;
  authorId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  raw: unknown;
};

export type DbReaction = {
  id: string;
  subjectType: string;
  subjectId: string;
  userId?: string | null;
  content?: string | null;
  createdAt?: string | null;
  raw: unknown;
};

export type DbReviewRequest = {
  id: string;
  pullRequestId: string;
  reviewerId?: string | null;
  requestedAt: string;
  raw: unknown;
};

export type SyncLogStatus = "success" | "failed" | "running";

function toJsonb(value: unknown) {
  return JSON.stringify(value ?? null);
}

export async function upsertUser(actor: DbActor | null) {
  if (!actor?.id) {
    return;
  }

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
      actor.avatarUrl ?? null,
      actor.createdAt ?? null,
      actor.updatedAt ?? null,
      toJsonb(actor),
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
}

export async function recordSyncLog(
  resource: string,
  status: SyncLogStatus,
  message?: string,
) {
  const result = await query<{ id: number }>(
    `INSERT INTO sync_log (resource, status, message, started_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [resource, status, message ?? null],
  );
  return result.rows[0]?.id;
}

export async function updateSyncLog(
  id: number,
  status: SyncLogStatus,
  message?: string,
) {
  await query(
    `UPDATE sync_log
     SET status = $2, message = $3, finished_at = NOW()
     WHERE id = $1`,
    [id, status, message ?? null],
  );
}

export async function updateSyncState(
  resource: string,
  lastCursor: string | null,
  lastItemTimestamp: string | null,
) {
  await query(
    `INSERT INTO sync_state (resource, last_cursor, last_item_timestamp, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (resource) DO UPDATE SET
       last_cursor = EXCLUDED.last_cursor,
       last_item_timestamp = EXCLUDED.last_item_timestamp,
       updated_at = NOW()`,
    [resource, lastCursor, lastItemTimestamp],
  );
}

export async function getSyncState(resource: string) {
  const result = await query(
    `SELECT resource, last_cursor, last_item_timestamp, updated_at
     FROM sync_state
     WHERE resource = $1`,
    [resource],
  );
  return result.rows[0] ?? null;
}

export async function getSyncConfig() {
  const result = await query(
    `SELECT id, org_name, auto_sync_enabled, sync_interval_minutes, timezone, week_start, excluded_repository_ids, last_sync_started_at, last_sync_completed_at, last_successful_sync_at
     FROM sync_config
     WHERE id = 'default'`,
  );

  return result.rows[0] ?? null;
}

export async function updateSyncConfig(params: {
  orgName?: string;
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number;
  timezone?: string;
  weekStart?: "sunday" | "monday";
  excludedRepositories?: string[];
  lastSyncStartedAt?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
}) {
  const fields = [] as string[];
  const values = [] as unknown[];

  if (typeof params.orgName === "string") {
    fields.push(`org_name = $${fields.length + 1}`);
    values.push(params.orgName);
  }

  if (typeof params.autoSyncEnabled === "boolean") {
    fields.push(`auto_sync_enabled = $${fields.length + 1}`);
    values.push(params.autoSyncEnabled);
  }

  if (typeof params.syncIntervalMinutes === "number") {
    fields.push(`sync_interval_minutes = $${fields.length + 1}`);
    values.push(params.syncIntervalMinutes);
  }

  if (typeof params.timezone === "string") {
    fields.push(`timezone = $${fields.length + 1}`);
    values.push(params.timezone);
  }

  if (typeof params.weekStart === "string") {
    fields.push(`week_start = $${fields.length + 1}`);
    values.push(params.weekStart);
  }

  if (Array.isArray(params.excludedRepositories)) {
    fields.push(`excluded_repository_ids = $${fields.length + 1}`);
    values.push(params.excludedRepositories);
  }

  if (params.lastSyncStartedAt !== undefined) {
    fields.push(`last_sync_started_at = $${fields.length + 1}`);
    values.push(params.lastSyncStartedAt);
  }

  if (params.lastSyncCompletedAt !== undefined) {
    fields.push(`last_sync_completed_at = $${fields.length + 1}`);
    values.push(params.lastSyncCompletedAt);
  }

  if (params.lastSuccessfulSyncAt !== undefined) {
    fields.push(`last_successful_sync_at = $${fields.length + 1}`);
    values.push(params.lastSuccessfulSyncAt);
  }

  if (!fields.length) {
    return;
  }

  const assignments = fields.join(", ");
  const updateValues = values.map((value) => value ?? null);

  await query(
    `UPDATE sync_config
     SET ${assignments}, updated_at = NOW()
     WHERE id = 'default'`,
    updateValues,
  );
}

export async function resetData({
  preserveLogs = true,
}: {
  preserveLogs?: boolean;
}) {
  if (preserveLogs) {
    await query(
      `TRUNCATE comments, reviews, issues, pull_requests, repositories, users RESTART IDENTITY CASCADE`,
    );
  } else {
    await query(
      `TRUNCATE comments, reviews, issues, pull_requests, repositories, users, sync_log, sync_state RESTART IDENTITY CASCADE`,
    );
  }
}

export async function deleteSyncLogs() {
  await query(`TRUNCATE sync_log RESTART IDENTITY CASCADE`);
}

export async function getLatestSyncLogs(limit = 20) {
  const result = await query(
    `SELECT id, resource, status, message, started_at, finished_at
     FROM sync_log
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

type CountRow = {
  type: TableCountKey;
  count: string;
};

export async function getCountsByTable(): Promise<TableCountSummary[]> {
  const result = await query<CountRow>(
    `SELECT 'issues' AS type, COUNT(*)::bigint AS count FROM issues
     UNION ALL
     SELECT 'pull_requests', COUNT(*)::bigint FROM pull_requests
     UNION ALL
     SELECT 'reviews', COUNT(*)::bigint FROM reviews
     UNION ALL
     SELECT 'comments', COUNT(*)::bigint FROM comments`,
  );
  return result.rows.map((row) => ({
    type: row.type,
    count: Number(row.count),
  }));
}

export async function getTimeRangeByTable(
  table: "issues" | "pull_requests",
): Promise<RangeSummary> {
  const result = await query<RangeSummary>(
    `SELECT MIN(github_created_at) AS oldest, MAX(github_updated_at) AS newest FROM ${table}`,
  );
  const row = result.rows[0];
  return {
    oldest: row?.oldest ?? null,
    newest: row?.newest ?? null,
  };
}

type TopUserRow = {
  author_id: string;
  issue_count: string;
};

export async function getTopUsersByIssues(limit = 5): Promise<TopUserRow[]> {
  const result = await query<TopUserRow>(
    `SELECT author_id, COUNT(*)::bigint AS issue_count
     FROM issues
     WHERE author_id IS NOT NULL
     GROUP BY author_id
     ORDER BY issue_count DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

type TopRepositoryRow = {
  repository_id: string;
  issue_count: string;
  pull_request_count: string;
};

export async function getTopRepositoriesByActivity(
  limit = 5,
): Promise<TopRepositoryRow[]> {
  const result = await query<TopRepositoryRow>(
    `SELECT repository_id,
            SUM(CASE WHEN type = 'issue' THEN count ELSE 0 END) AS issue_count,
            SUM(CASE WHEN type = 'pr' THEN count ELSE 0 END) AS pull_request_count
     FROM (
       SELECT repository_id, COUNT(*)::bigint AS count, 'issue' AS type
       FROM issues
       GROUP BY repository_id
       UNION ALL
       SELECT repository_id, COUNT(*)::bigint AS count, 'pr' AS type
       FROM pull_requests
       GROUP BY repository_id
     ) AS combined
     GROUP BY repository_id
     ORDER BY (SUM(count)) DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function updateSyncTimestamps(status: {
  startedAt?: string | null;
  completedAt?: string | null;
  successfulAt?: string | null;
}) {
  await updateSyncConfig({
    lastSyncStartedAt: status.startedAt ?? undefined,
    lastSyncCompletedAt: status.completedAt ?? undefined,
    lastSuccessfulSyncAt: status.successfulAt ?? undefined,
  });
}

type UserProfileRow = {
  id: string;
  login: string | null;
  name: string | null;
  avatar_url: string | null;
};

export async function getUserProfiles(ids: string[]): Promise<UserProfile[]> {
  if (!ids.length) {
    return [];
  }

  const result = await query<UserProfileRow>(
    `SELECT id, login, name, avatar_url FROM users WHERE id = ANY($1::text[])`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  }));
}

type RepositoryProfileRow = {
  id: string;
  name: string | null;
  name_with_owner: string | null;
};

export async function getRepositoryProfiles(
  ids: string[],
): Promise<RepositoryProfile[]> {
  if (!ids.length) {
    return [];
  }

  const result = await query<RepositoryProfileRow>(
    `SELECT id, name, name_with_owner FROM repositories WHERE id = ANY($1::text[])`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameWithOwner: row.name_with_owner,
  }));
}

export async function listAllRepositories(): Promise<RepositoryProfile[]> {
  const result = await query<RepositoryProfileRow>(
    `SELECT id, name, name_with_owner
     FROM repositories
     ORDER BY name_with_owner NULLS LAST, name NULLS LAST, id`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameWithOwner: row.name_with_owner,
  }));
}

export async function getDashboardStats(): Promise<DashboardSummary> {
  const [counts, issuesRange, prsRange, topUsers, topRepos] = await Promise.all(
    [
      getCountsByTable(),
      getTimeRangeByTable("issues"),
      getTimeRangeByTable("pull_requests"),
      getTopUsersByIssues(5),
      getTopRepositoriesByActivity(5),
    ],
  );

  const userIds = topUsers
    .map((row) => row.author_id)
    .filter((value): value is string => Boolean(value));
  const repositoryIds = topRepos
    .map((row) => row.repository_id)
    .filter((value): value is string => Boolean(value));

  const [userProfiles, repositoryProfiles] = await Promise.all([
    getUserProfiles(userIds),
    getRepositoryProfiles(repositoryIds),
  ]);

  const userMap = new Map(userProfiles.map((profile) => [profile.id, profile]));
  const repositoryMap = new Map(
    repositoryProfiles.map((profile) => [profile.id, profile]),
  );

  return {
    counts,
    issuesRange,
    pullRequestsRange: prsRange,
    topUsers: topUsers.map((row) => ({
      authorId: row.author_id,
      issueCount: Number(row.issue_count),
      profile: userMap.get(row.author_id) ?? null,
    })),
    topRepositories: topRepos.map((row) => ({
      repositoryId: row.repository_id,
      issueCount: Number(row.issue_count),
      pullRequestCount: Number(row.pull_request_count),
      repository: repositoryMap.get(row.repository_id) ?? null,
    })),
  };
}

export async function getDataFreshness() {
  const result = await query(
    `SELECT last_successful_sync_at FROM sync_config WHERE id = 'default'`,
  );
  return result.rows[0]?.last_successful_sync_at ?? null;
}
