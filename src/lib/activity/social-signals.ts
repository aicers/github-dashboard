import { query } from "@/lib/db/client";

const SOCIAL_SIGNALS_CACHE_KEY = "social_signals_snapshot";

type RefreshIds = readonly string[] | undefined;

type NormalizedIds = string[] | null;

export type SocialSignalRefreshOptions = {
  issueIds?: RefreshIds;
  pullRequestIds?: RefreshIds;
  truncate?: boolean;
};

function normalizeIds(ids?: RefreshIds): NormalizedIds {
  if (ids === undefined) {
    return null;
  }

  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") {
      continue;
    }
    const trimmed = id.trim();
    if (!trimmed.length) {
      continue;
    }
    unique.add(trimmed);
  }

  return Array.from(unique);
}

function shouldSkip(ids: NormalizedIds) {
  return Array.isArray(ids) && ids.length === 0;
}

function issueItemTypeExpression() {
  return `(CASE
    WHEN LOWER(COALESCE(i.data->>'__typename', '')) = 'discussion'
      OR POSITION('/discussions/' IN COALESCE(i.data->>'url', '')) > 0
      THEN 'discussion'
    ELSE 'issue'
  END)`;
}

async function upsertIssueCommentParticipants(issueIds: NormalizedIds) {
  if (shouldSkip(issueIds)) {
    return;
  }

  const filterClause = issueIds === null ? "" : "WHERE i.id = ANY($1::text[])";
  const params = issueIds === null ? [] : [issueIds];

  await query(
    `
      INSERT INTO activity_comment_participants (item_id, item_type, participant_ids, updated_at)
      SELECT
        i.id AS item_id,
        ${issueItemTypeExpression()} AS item_type,
        COALESCE(stats.participant_ids, ARRAY[]::text[]) AS participant_ids,
        NOW()
      FROM issues i
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT c.author_id) FILTER (WHERE c.author_id IS NOT NULL) AS participant_ids
        FROM comments c
        WHERE c.issue_id = i.id
      ) stats ON TRUE
      ${filterClause}
      ON CONFLICT (item_id) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        participant_ids = EXCLUDED.participant_ids,
        updated_at = NOW()
    `,
    params,
  );
}

async function upsertPullRequestCommentParticipants(
  pullRequestIds: NormalizedIds,
) {
  if (shouldSkip(pullRequestIds)) {
    return;
  }

  const filterClause =
    pullRequestIds === null ? "" : "WHERE pr.id = ANY($1::text[])";
  const params = pullRequestIds === null ? [] : [pullRequestIds];

  await query(
    `
      INSERT INTO activity_comment_participants (item_id, item_type, participant_ids, updated_at)
      SELECT
        pr.id AS item_id,
        'pull_request' AS item_type,
        COALESCE(stats.participant_ids, ARRAY[]::text[]) AS participant_ids,
        NOW()
      FROM pull_requests pr
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT c.author_id) FILTER (WHERE c.author_id IS NOT NULL) AS participant_ids
        FROM comments c
        WHERE c.pull_request_id = pr.id
      ) stats ON TRUE
      ${filterClause}
      ON CONFLICT (item_id) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        participant_ids = EXCLUDED.participant_ids,
        updated_at = NOW()
    `,
    params,
  );
}

async function upsertIssueCommentMentions(issueIds: NormalizedIds) {
  if (shouldSkip(issueIds)) {
    return;
  }

  const filterClause = issueIds === null ? "" : "WHERE i.id = ANY($1::text[])";
  const params = issueIds === null ? [] : [issueIds];

  await query(
    `
      INSERT INTO activity_comment_mentions (item_id, item_type, mentioned_ids, updated_at)
      SELECT
        i.id AS item_id,
        ${issueItemTypeExpression()} AS item_type,
        COALESCE(stats.mentioned_ids, ARRAY[]::text[]) AS mentioned_ids,
        NOW()
      FROM issues i
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS mentioned_ids
        FROM comments c
        CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
        LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
        WHERE c.issue_id = i.id
      ) stats ON TRUE
      ${filterClause}
      ON CONFLICT (item_id) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        mentioned_ids = EXCLUDED.mentioned_ids,
        updated_at = NOW()
    `,
    params,
  );
}

async function upsertPullRequestCommentMentions(pullRequestIds: NormalizedIds) {
  if (shouldSkip(pullRequestIds)) {
    return;
  }

  const filterClause =
    pullRequestIds === null ? "" : "WHERE pr.id = ANY($1::text[])";
  const params = pullRequestIds === null ? [] : [pullRequestIds];

  await query(
    `
      INSERT INTO activity_comment_mentions (item_id, item_type, mentioned_ids, updated_at)
      SELECT
        pr.id AS item_id,
        'pull_request' AS item_type,
        COALESCE(stats.mentioned_ids, ARRAY[]::text[]) AS mentioned_ids,
        NOW()
      FROM pull_requests pr
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS mentioned_ids
        FROM comments c
        CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
        LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
        WHERE c.pull_request_id = pr.id
      ) stats ON TRUE
      ${filterClause}
      ON CONFLICT (item_id) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        mentioned_ids = EXCLUDED.mentioned_ids,
        updated_at = NOW()
    `,
    params,
  );
}

async function upsertIssueReactionUsers(issueIds: NormalizedIds) {
  if (shouldSkip(issueIds)) {
    return;
  }

  const filterClause = issueIds === null ? "" : "WHERE i.id = ANY($1::text[])";
  const params = issueIds === null ? [] : [issueIds];

  await query(
    `
      INSERT INTO activity_reaction_users (item_id, item_type, reactor_ids, updated_at)
      SELECT
        i.id AS item_id,
        ${issueItemTypeExpression()} AS item_type,
        COALESCE(stats.reactor_ids, ARRAY[]::text[]) AS reactor_ids,
        NOW()
      FROM issues i
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL) AS reactor_ids
        FROM reactions r
        WHERE r.subject_id = i.id
          AND LOWER(r.subject_type) IN ('issue', 'discussion')
      ) stats ON TRUE
      ${filterClause}
      ON CONFLICT (item_id) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        reactor_ids = EXCLUDED.reactor_ids,
        updated_at = NOW()
    `,
    params,
  );
}

async function upsertPullRequestReactionUsers(pullRequestIds: NormalizedIds) {
  if (shouldSkip(pullRequestIds)) {
    return;
  }

  const filterClause =
    pullRequestIds === null ? "" : "WHERE pr.id = ANY($1::text[])";
  const params = pullRequestIds === null ? [] : [pullRequestIds];

  await query(
    `
      INSERT INTO activity_reaction_users (item_id, item_type, reactor_ids, updated_at)
      SELECT
        pr.id AS item_id,
        'pull_request' AS item_type,
        COALESCE(stats.reactor_ids, ARRAY[]::text[]) AS reactor_ids,
        NOW()
      FROM pull_requests pr
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL) AS reactor_ids
        FROM reactions r
        WHERE r.subject_id = pr.id
          AND LOWER(r.subject_type) = 'pullrequest'
      ) stats ON TRUE
      ${filterClause}
      ON CONFLICT (item_id) DO UPDATE SET
        item_type = EXCLUDED.item_type,
        reactor_ids = EXCLUDED.reactor_ids,
        updated_at = NOW()
    `,
    params,
  );
}

export async function refreshActivitySocialSignals(
  options?: SocialSignalRefreshOptions,
) {
  const truncate = options?.truncate ?? false;
  if (options?.truncate) {
    await query(
      `
        TRUNCATE TABLE
          activity_comment_participants,
          activity_comment_mentions,
          activity_reaction_users
      `,
    );
  }

  const issueIds = normalizeIds(options?.issueIds);
  const pullRequestIds = normalizeIds(options?.pullRequestIds);

  await upsertIssueCommentParticipants(issueIds);
  await upsertPullRequestCommentParticipants(pullRequestIds);
  await upsertIssueCommentMentions(issueIds);
  await upsertPullRequestCommentMentions(pullRequestIds);
  await upsertIssueReactionUsers(issueIds);
  await upsertPullRequestReactionUsers(pullRequestIds);

  if (truncate) {
    const [participantCountResult, mentionCountResult, reactorCountResult] =
      await Promise.all([
        query<{ row_count: number }>(
          `SELECT COUNT(*)::int AS row_count FROM activity_comment_participants`,
        ),
        query<{ row_count: number }>(
          `SELECT COUNT(*)::int AS row_count FROM activity_comment_mentions`,
        ),
        query<{ row_count: number }>(
          `SELECT COUNT(*)::int AS row_count FROM activity_reaction_users`,
        ),
      ]);

    const participantRows = participantCountResult.rows[0]?.row_count ?? 0;
    const mentionRows = mentionCountResult.rows[0]?.row_count ?? 0;
    const reactorRows = reactorCountResult.rows[0]?.row_count ?? 0;

    await query(
      `
        INSERT INTO activity_cache_state (
          cache_key,
          generated_at,
          sync_run_id,
          item_count,
          metadata,
          updated_at
        )
        VALUES (
          $1,
          NOW(),
          NULL,
          $2::int,
          jsonb_build_object(
            'mode', 'truncate',
            'participantRows', $2::int,
            'mentionRows', $3::int,
            'reactorRows', $4::int
          ),
          NOW()
        )
        ON CONFLICT (cache_key) DO UPDATE SET
          generated_at = EXCLUDED.generated_at,
          sync_run_id = NULL,
          item_count = EXCLUDED.item_count,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
      [SOCIAL_SIGNALS_CACHE_KEY, participantRows, mentionRows, reactorRows],
    );
  }
}
