import type { PoolClient } from "pg";
import {
  ISSUE_PRIORITY_VALUES,
  ISSUE_WEIGHT_VALUES,
} from "@/lib/activity/constants";
import type {
  ActivityFilterOptions,
  ActivityLabel,
  ActivityLinkedIssue,
  ActivityLinkedPullRequest,
  ActivityLinkedPullRequestStatus,
  ActivityUser,
} from "@/lib/activity/types";
import { ensureSchema } from "@/lib/db";
import { query, withTransaction } from "@/lib/db/client";
import { getSyncConfig } from "@/lib/db/operations";

const FILTER_CACHE_KEY = "activity-filter-options";
const ISSUE_LINKS_CACHE_KEY = "activity-issue-links";
const PULL_REQUEST_LINKS_CACHE_KEY = "activity-pull-request-links";

type CacheStateRow = {
  cache_key: string;
  generated_at: string | null;
  sync_run_id: number | null;
  item_count: number | null;
  metadata: unknown;
};

type CacheRefreshSummary = {
  cacheKey: string;
  generatedAt: string;
  syncRunId: number | null;
  itemCount: number;
  metadata: Record<string, unknown>;
};

export type ActivityCacheRefreshResult = {
  filterOptions: CacheRefreshSummary;
  issueLinks: CacheRefreshSummary;
  pullRequestLinks: CacheRefreshSummary;
};

let pendingCacheRefresh: Promise<ActivityCacheRefreshResult> | null = null;

type FilterOptionsCounts = {
  repositories: number;
  labels: number;
  users: number;
  issueTypes: number;
  milestones: number;
  total: number;
};

type FilterOptionsCacheRow = {
  payload: unknown;
};

type CacheStatus = CacheStateRow & {
  metadata: Record<string, unknown> | null;
};

type IssueLinksCacheRow = {
  issue_id: string;
  links: unknown;
};

type PullRequestLinksCacheRow = {
  pull_request_id: string;
  links: unknown;
};

export async function ensureActivityCaches(params?: {
  runId?: number | null;
  reason?: string;
  force?: boolean;
}): Promise<ActivityCacheRefreshResult | null> {
  await ensureSchema();
  const runId = params?.runId ?? null;
  const reason = params?.reason ?? (runId ? "sync" : "manual");
  const force = params?.force ?? false;
  const config = await getSyncConfig();
  const lastSuccessfulSyncAt = config?.last_successful_sync_at ?? null;
  const states = (await Promise.all([
    getCacheState(FILTER_CACHE_KEY),
    getCacheState(ISSUE_LINKS_CACHE_KEY),
    getCacheState(PULL_REQUEST_LINKS_CACHE_KEY),
  ])) as [CacheStatus | null, CacheStatus | null, CacheStatus | null];
  const summary = buildSummaryFromStates(states);
  const isFresh =
    summary !== null &&
    states.every((state) => isCacheFresh(state, lastSuccessfulSyncAt));

  if (!force && isFresh && summary) {
    return summary;
  }

  const refreshed = await refreshActivityCaches({ runId, reason });
  return refreshed;
}

export async function refreshActivityCaches(params?: {
  runId?: number | null;
  reason?: string;
}): Promise<ActivityCacheRefreshResult> {
  const runId = params?.runId ?? null;
  const reason = params?.reason ?? (runId ? "sync" : "manual");

  if (pendingCacheRefresh) {
    return pendingCacheRefresh;
  }

  const refreshPromise = executeCacheRefresh({ runId, reason });
  pendingCacheRefresh = refreshPromise;

  return refreshPromise.finally(() => {
    if (pendingCacheRefresh === refreshPromise) {
      pendingCacheRefresh = null;
    }
  });
}

export async function getActivityCacheSummary(): Promise<ActivityCacheRefreshResult | null> {
  const states = (await Promise.all([
    getCacheState(FILTER_CACHE_KEY),
    getCacheState(ISSUE_LINKS_CACHE_KEY),
    getCacheState(PULL_REQUEST_LINKS_CACHE_KEY),
  ])) as [CacheStatus | null, CacheStatus | null, CacheStatus | null];
  return buildSummaryFromStates(states);
}

function scheduleCacheRefresh(reason: string) {
  refreshActivityCaches({ reason }).catch((error) => {
    console.error(
      "[activity-cache] Scheduled cache refresh failed",
      reason,
      error,
    );
  });
}

async function executeCacheRefresh(params: {
  runId: number | null;
  reason: string;
}): Promise<ActivityCacheRefreshResult> {
  await ensureSchema();
  const { runId, reason } = params;

  return withTransaction(async (client) => {
    const filterOptions = await refreshFilterOptionsCache({
      client,
      runId,
      reason,
    });
    const issueLinks = await refreshIssueLinksCache({
      client,
      runId,
      reason,
    });
    const pullRequestLinks = await refreshPullRequestLinksCache({
      client,
      runId,
      reason,
    });

    return {
      filterOptions,
      issueLinks,
      pullRequestLinks,
    };
  });
}

function buildSummaryFromStates(
  states: [CacheStatus | null, CacheStatus | null, CacheStatus | null],
): ActivityCacheRefreshResult | null {
  const [filterState, issueState, prState] = states;
  const filterSummary = toCacheRefreshSummary(filterState, FILTER_CACHE_KEY);
  const issueSummary = toCacheRefreshSummary(issueState, ISSUE_LINKS_CACHE_KEY);
  const prSummary = toCacheRefreshSummary(
    prState,
    PULL_REQUEST_LINKS_CACHE_KEY,
  );

  if (!filterSummary || !issueSummary || !prSummary) {
    return null;
  }

  return {
    filterOptions: filterSummary,
    issueLinks: issueSummary,
    pullRequestLinks: prSummary,
  };
}

function toCacheRefreshSummary(
  state: CacheStatus | null,
  cacheKey: string,
): CacheRefreshSummary | null {
  if (!state?.generated_at) {
    return null;
  }

  return {
    cacheKey,
    generatedAt: state.generated_at,
    syncRunId: state.sync_run_id ?? null,
    itemCount: state.item_count ?? 0,
    metadata:
      state.metadata && typeof state.metadata === "object"
        ? (state.metadata as Record<string, unknown>)
        : {},
  };
}

export async function getCachedActivityFilterOptions(): Promise<ActivityFilterOptions> {
  const config = await getSyncConfig();
  const lastSuccessfulSyncAt = config?.last_successful_sync_at ?? null;
  const state = await getCacheState(FILTER_CACHE_KEY);

  if (isCacheFresh(state, lastSuccessfulSyncAt)) {
    const cached = await query<FilterOptionsCacheRow>(
      `SELECT payload
         FROM activity_filter_options_cache
         WHERE id = 'default'
         LIMIT 1`,
    );
    const row = cached.rows[0];
    const payload = parseJson<ActivityFilterOptions>(row?.payload ?? null);
    if (payload) {
      return payload;
    }
    logCacheFallback(
      FILTER_CACHE_KEY,
      "payload parse failure",
      state,
      lastSuccessfulSyncAt,
    );
    scheduleCacheRefresh("fallback:filter-options:parse-failure");
  } else {
    logCacheFallback(
      FILTER_CACHE_KEY,
      state ? "stale" : "miss",
      state,
      lastSuccessfulSyncAt,
    );
    scheduleCacheRefresh("fallback:filter-options");
  }

  const snapshot = await computeFilterOptionsSnapshot(config);
  scheduleCacheRefresh("fallback:filter-options:computed");
  return snapshot.options;
}

export async function getLinkedPullRequestsMap(
  issueIds: readonly string[],
  options?: { lastSuccessfulSyncAt?: string | null },
): Promise<Map<string, ActivityLinkedPullRequest[]>> {
  if (!issueIds.length) {
    return new Map();
  }

  const lastSuccessfulSyncAt =
    options?.lastSuccessfulSyncAt ?? (await resolveLastSuccessfulSyncAt());
  const state = await getCacheState(ISSUE_LINKS_CACHE_KEY);

  if (isCacheFresh(state, lastSuccessfulSyncAt)) {
    const cached = await query<IssueLinksCacheRow>(
      `SELECT issue_id, links
         FROM activity_issue_links_cache
         WHERE issue_id = ANY($1::text[])`,
      [Array.from(issueIds)],
    );
    const result = new Map<string, ActivityLinkedPullRequest[]>();
    let parseFailure = false;
    cached.rows.forEach((row) => {
      const entries = mapCachedLinkedPullRequests(row.links);
      if (!entries) {
        parseFailure = true;
        return;
      }
      result.set(row.issue_id, entries);
    });

    if (!parseFailure) {
      return result;
    }

    logCacheFallback(
      ISSUE_LINKS_CACHE_KEY,
      parseFailure ? "payload parse failure" : "empty result",
      state,
      lastSuccessfulSyncAt,
    );
    scheduleCacheRefresh(
      parseFailure
        ? "fallback:issue-links:parse-failure"
        : "fallback:issue-links:empty",
    );
  } else {
    logCacheFallback(
      ISSUE_LINKS_CACHE_KEY,
      state ? "stale" : "miss",
      state,
      lastSuccessfulSyncAt,
    );
    scheduleCacheRefresh("fallback:issue-links");
  }

  return queryLinkedPullRequestsDirect(issueIds);
}

export async function getLinkedIssuesMap(
  pullRequestIds: readonly string[],
  options?: { lastSuccessfulSyncAt?: string | null },
): Promise<Map<string, ActivityLinkedIssue[]>> {
  if (!pullRequestIds.length) {
    return new Map();
  }

  const lastSuccessfulSyncAt =
    options?.lastSuccessfulSyncAt ?? (await resolveLastSuccessfulSyncAt());
  const state = await getCacheState(PULL_REQUEST_LINKS_CACHE_KEY);

  if (isCacheFresh(state, lastSuccessfulSyncAt)) {
    const cached = await query<PullRequestLinksCacheRow>(
      `SELECT pull_request_id, links
         FROM activity_pull_request_links_cache
         WHERE pull_request_id = ANY($1::text[])`,
      [Array.from(pullRequestIds)],
    );
    const result = new Map<string, ActivityLinkedIssue[]>();
    let parseFailure = false;
    cached.rows.forEach((row) => {
      const entries = mapCachedLinkedIssues(row.links);
      if (!entries) {
        parseFailure = true;
        return;
      }
      result.set(row.pull_request_id, entries);
    });

    if (!parseFailure) {
      return result;
    }

    logCacheFallback(
      PULL_REQUEST_LINKS_CACHE_KEY,
      parseFailure ? "payload parse failure" : "empty result",
      state,
      lastSuccessfulSyncAt,
    );
    scheduleCacheRefresh(
      parseFailure
        ? "fallback:pull-request-links:parse-failure"
        : "fallback:pull-request-links:empty",
    );
  } else {
    logCacheFallback(
      PULL_REQUEST_LINKS_CACHE_KEY,
      state ? "stale" : "miss",
      state,
      lastSuccessfulSyncAt,
    );
    scheduleCacheRefresh("fallback:pull-request-links");
  }

  return queryLinkedIssuesDirect(pullRequestIds);
}

async function refreshFilterOptionsCache(params: {
  client: PoolClient;
  runId: number | null;
  reason: string;
}): Promise<CacheRefreshSummary> {
  const { client, runId, reason } = params;
  const config = await getSyncConfig();
  const snapshot = await computeFilterOptionsSnapshot(config);
  const generatedAt = new Date().toISOString();

  await client.query(
    `INSERT INTO activity_filter_options_cache (
       id,
       payload,
       generated_at,
       sync_run_id,
       repository_count,
       label_count,
       user_count,
       issue_type_count,
       milestone_count
     )
     VALUES (
       'default',
       $1::jsonb,
       $2::timestamptz,
       $3::int,
       $4::int,
       $5::int,
       $6::int,
       $7::int,
       $8::int
     )
     ON CONFLICT (id) DO UPDATE SET
       payload = EXCLUDED.payload,
       generated_at = EXCLUDED.generated_at,
       sync_run_id = EXCLUDED.sync_run_id,
       repository_count = EXCLUDED.repository_count,
       label_count = EXCLUDED.label_count,
       user_count = EXCLUDED.user_count,
       issue_type_count = EXCLUDED.issue_type_count,
       milestone_count = EXCLUDED.milestone_count`,
    [
      JSON.stringify(snapshot.options),
      generatedAt,
      runId,
      snapshot.counts.repositories,
      snapshot.counts.labels,
      snapshot.counts.users,
      snapshot.counts.issueTypes,
      snapshot.counts.milestones,
    ],
  );

  await upsertCacheState(client, {
    cacheKey: FILTER_CACHE_KEY,
    generatedAt,
    runId,
    itemCount: snapshot.counts.total,
    metadata: {
      reason,
      counts: snapshot.counts,
    },
  });

  return {
    cacheKey: FILTER_CACHE_KEY,
    generatedAt,
    syncRunId: runId,
    itemCount: snapshot.counts.total,
    metadata: {
      reason,
      counts: snapshot.counts,
    },
  };
}

async function refreshIssueLinksCache(params: {
  client: PoolClient;
  runId: number | null;
  reason: string;
}): Promise<CacheRefreshSummary> {
  const { client, runId, reason } = params;
  const generatedAt = new Date().toISOString();

  await client.query(`DELETE FROM activity_issue_links_cache`);

  await client.query(
    `INSERT INTO activity_issue_links_cache (
       issue_id,
       links,
       link_count,
       generated_at,
       sync_run_id
     )
     SELECT
       issue_id,
       links,
       link_count,
       $1::timestamptz,
       $2::int
     FROM (
       SELECT
         pri.issue_id,
         COUNT(*)::int AS link_count,
         jsonb_agg(
           jsonb_build_object(
             'id', pr.id,
             'number', pr.number,
             'title', pr.title,
             'state', pr.state,
             'status',
               CASE
                 WHEN pr.merged THEN 'merged'
                 WHEN LOWER(COALESCE(pr.state, '')) = 'closed'
                   OR pr.github_closed_at IS NOT NULL
                   THEN 'closed'
                 WHEN LOWER(COALESCE(pr.state, '')) = 'merged' THEN 'merged'
                 ELSE 'open'
               END,
             'repositoryNameWithOwner', repo.name_with_owner,
             'url', pr.data->>'url',
             'mergedAt',
               CASE
                 WHEN pr.github_merged_at IS NULL THEN NULL
                 ELSE to_char(
                   pr.github_merged_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 )
               END,
             'closedAt',
               CASE
                 WHEN pr.github_closed_at IS NULL THEN NULL
                 ELSE to_char(
                   pr.github_closed_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 )
               END,
             'updatedAt',
               CASE
                 WHEN pr.github_updated_at IS NULL THEN NULL
                 ELSE to_char(
                   pr.github_updated_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 )
               END
           )
           ORDER BY pr.github_updated_at DESC NULLS LAST, pr.github_created_at DESC
         ) AS links
       FROM pull_request_issues pri
       JOIN pull_requests pr ON pr.id = pri.pull_request_id
       JOIN repositories repo ON repo.id = pr.repository_id
       GROUP BY pri.issue_id
     ) AS aggregated`,
    [generatedAt, runId],
  );

  const metrics = await client.query<{
    row_count: number;
    link_count: number;
  }>(
    `SELECT
       COUNT(*)::int AS row_count,
       COALESCE(SUM(link_count), 0)::int AS link_count
     FROM activity_issue_links_cache`,
  );
  const row = metrics.rows[0] ?? { row_count: 0, link_count: 0 };

  await upsertCacheState(client, {
    cacheKey: ISSUE_LINKS_CACHE_KEY,
    generatedAt,
    runId,
    itemCount: row.row_count,
    metadata: {
      reason,
      linkCount: row.link_count,
    },
  });

  return {
    cacheKey: ISSUE_LINKS_CACHE_KEY,
    generatedAt,
    syncRunId: runId,
    itemCount: row.row_count,
    metadata: {
      reason,
      linkCount: row.link_count,
    },
  };
}

async function refreshPullRequestLinksCache(params: {
  client: PoolClient;
  runId: number | null;
  reason: string;
}): Promise<CacheRefreshSummary> {
  const { client, runId, reason } = params;
  const generatedAt = new Date().toISOString();

  await client.query(`DELETE FROM activity_pull_request_links_cache`);

  await client.query(
    `INSERT INTO activity_pull_request_links_cache (
       pull_request_id,
       links,
       link_count,
       generated_at,
       sync_run_id
     )
     SELECT
       pull_request_id,
       links,
       link_count,
       $1::timestamptz,
       $2::int
     FROM (
       SELECT
         pri.pull_request_id,
         COUNT(*)::int AS link_count,
         jsonb_agg(
           jsonb_build_object(
             'id', COALESCE(i.id, pri.issue_id),
             'number', COALESCE(i.number, pri.issue_number),
             'title', COALESCE(i.title, pri.issue_title),
             'state', COALESCE(i.state, pri.issue_state),
             'repositoryNameWithOwner', COALESCE(repo.name_with_owner, pri.issue_repository),
             'url', COALESCE(i.data->>'url', pri.issue_url)
           )
           ORDER BY pri.updated_at DESC NULLS LAST
         ) AS links
       FROM pull_request_issues pri
       LEFT JOIN issues i ON i.id = pri.issue_id
       LEFT JOIN repositories repo ON repo.id = i.repository_id
       GROUP BY pri.pull_request_id
     ) AS aggregated`,
    [generatedAt, runId],
  );

  const metrics = await client.query<{
    row_count: number;
    link_count: number;
  }>(
    `SELECT
       COUNT(*)::int AS row_count,
       COALESCE(SUM(link_count), 0)::int AS link_count
     FROM activity_pull_request_links_cache`,
  );
  const row = metrics.rows[0] ?? { row_count: 0, link_count: 0 };

  await upsertCacheState(client, {
    cacheKey: PULL_REQUEST_LINKS_CACHE_KEY,
    generatedAt,
    runId,
    itemCount: row.row_count,
    metadata: {
      reason,
      linkCount: row.link_count,
    },
  });

  return {
    cacheKey: PULL_REQUEST_LINKS_CACHE_KEY,
    generatedAt,
    syncRunId: runId,
    itemCount: row.row_count,
    metadata: {
      reason,
      linkCount: row.link_count,
    },
  };
}

async function upsertCacheState(
  client: PoolClient,
  params: {
    cacheKey: string;
    generatedAt: string;
    runId: number | null;
    itemCount: number;
    metadata: Record<string, unknown>;
  },
) {
  const { cacheKey, generatedAt, runId, itemCount, metadata } = params;
  await client.query(
    `INSERT INTO activity_cache_state (
       cache_key,
       generated_at,
       sync_run_id,
       item_count,
       metadata,
       updated_at
     )
     VALUES ($1, $2::timestamptz, $3::int, $4::int, $5::jsonb, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET
       generated_at = EXCLUDED.generated_at,
       sync_run_id = EXCLUDED.sync_run_id,
       item_count = EXCLUDED.item_count,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at`,
    [cacheKey, generatedAt, runId, itemCount, JSON.stringify(metadata)],
  );
}

async function computeFilterOptionsSnapshot(
  config: Awaited<ReturnType<typeof getSyncConfig>>,
): Promise<{
  options: ActivityFilterOptions;
  counts: FilterOptionsCounts;
}> {
  const [
    repositoriesResult,
    labelsResult,
    usersResult,
    issueTypesResult,
    milestonesResult,
  ] = await Promise.all([
    query<{
      id: string;
      name: string | null;
      name_with_owner: string | null;
    }>(
      `SELECT id, name, name_with_owner
         FROM repositories
         ORDER BY name_with_owner`,
    ),
    query<{
      repository_id: string;
      repository_name_with_owner: string | null;
      label_name: string;
    }>(
      `SELECT DISTINCT
         repo.id AS repository_id,
         repo.name_with_owner AS repository_name_with_owner,
         label_node->>'name' AS label_name
       FROM issues i
       JOIN repositories repo ON repo.id = i.repository_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
       WHERE label_node->>'name' IS NOT NULL
       UNION
       SELECT DISTINCT
         repo.id AS repository_id,
         repo.name_with_owner AS repository_name_with_owner,
         label_node->>'name' AS label_name
       FROM pull_requests pr
       JOIN repositories repo ON repo.id = pr.repository_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
       WHERE label_node->>'name' IS NOT NULL
       ORDER BY repository_name_with_owner, label_name`,
    ),
    query<{
      id: string;
      login: string | null;
      name: string | null;
      avatar_url: string | null;
    }>(
      `SELECT id, login, name, avatar_url
         FROM users
         ORDER BY LOWER(COALESCE(NULLIF(login, ''), NULLIF(name, ''), id))`,
    ),
    query<{
      id: string | null;
      name: string | null;
    }>(
      `SELECT id, name
         FROM (
           SELECT
             COALESCE(
               NULLIF(i.data->'issueType'->>'id', ''),
               CASE
                 WHEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
                   WHERE LOWER(label_node->>'name') = 'bug'
                 ) THEN 'label:issue_type:bug'
                 WHEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
                   WHERE LOWER(label_node->>'name') IN ('feature', 'feature request', 'enhancement')
                 ) THEN 'label:issue_type:feature'
                 WHEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
                   WHERE LOWER(label_node->>'name') IN ('task', 'todo', 'chore')
                 ) THEN 'label:issue_type:task'
                 ELSE NULL
               END
             ) AS id,
             COALESCE(
               NULLIF(i.data->'issueType'->>'name', ''),
               CASE
                 WHEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
                   WHERE LOWER(label_node->>'name') = 'bug'
                 ) THEN 'Bug'
                 WHEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
                   WHERE LOWER(label_node->>'name') IN ('feature', 'feature request', 'enhancement')
                 ) THEN 'Feature'
                 WHEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
                   WHERE LOWER(label_node->>'name') IN ('task', 'todo', 'chore')
                 ) THEN 'Task'
                 ELSE NULL
               END
             ) AS name
           FROM issues i
         ) AS issue_types
         WHERE id IS NOT NULL
         GROUP BY id, name
         ORDER BY LOWER(COALESCE(NULLIF(name, ''), id))`,
    ),
    query<{
      id: string | null;
      title: string | null;
      state: string | null;
      due_on: string | null;
      url: string | null;
    }>(
      `SELECT id, title, state, due_on, url
         FROM (
           SELECT
             NULLIF(i.data->'milestone'->>'id', '') AS id,
             NULLIF(i.data->'milestone'->>'title', '') AS title,
             NULLIF(i.data->'milestone'->>'state', '') AS state,
             NULLIF(i.data->'milestone'->>'dueOn', '') AS due_on,
             NULLIF(i.data->'milestone'->>'url', '') AS url
           FROM issues i
         ) AS milestones
         WHERE id IS NOT NULL
         GROUP BY id, title, state, due_on, url
         ORDER BY LOWER(COALESCE(NULLIF(title, ''), id))`,
    ),
  ]);

  const repositories: ActivityFilterOptions["repositories"] =
    repositoriesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      nameWithOwner: row.name_with_owner,
    }));

  const labels: ActivityLabel[] = labelsResult.rows.map((row) => ({
    key: `${row.repository_name_with_owner ?? row.repository_id}:${row.label_name}`,
    name: row.label_name,
    repositoryId: row.repository_id,
    repositoryNameWithOwner: row.repository_name_with_owner,
  }));

  const issueTypes = issueTypesResult.rows
    .filter((row) => typeof row.id === "string" && row.id.length > 0)
    .map((row) => ({
      id: row.id as string,
      name: row.name ?? null,
    }));

  const milestones = milestonesResult.rows
    .filter((row) => typeof row.id === "string" && row.id.length > 0)
    .map((row) => ({
      id: row.id as string,
      title: row.title ?? null,
      state: row.state ?? null,
      dueOn: row.due_on ?? null,
      url: row.url ?? null,
    }));

  const excludedUserIds = new Set<string>(
    Array.isArray(config?.excluded_user_ids)
      ? (config.excluded_user_ids as string[]).filter(
          (value) => typeof value === "string" && value.trim().length > 0,
        )
      : [],
  );

  const priorityLogins = ["octoaide", "codecov", "dependabot"];
  const priorityLookup = new Map(
    priorityLogins.map((login, index) => [login, index]),
  );

  const users: ActivityUser[] = usersResult.rows
    .filter((row) => !excludedUserIds.has(row.id))
    .map((row) => ({
      id: row.id,
      login: row.login,
      name: row.name,
      avatarUrl: row.avatar_url,
    }))
    .sort((first, second) => {
      const normalize = (user: ActivityUser) =>
        (user.login ?? user.name ?? user.id ?? "").toLowerCase();

      const firstPriority = priorityLookup.get(
        first.login ? first.login.toLowerCase() : "",
      );
      const secondPriority = priorityLookup.get(
        second.login ? second.login.toLowerCase() : "",
      );

      if (firstPriority !== undefined || secondPriority !== undefined) {
        if (firstPriority === undefined) {
          return 1;
        }
        if (secondPriority === undefined) {
          return -1;
        }
        return firstPriority - secondPriority;
      }

      return normalize(first).localeCompare(normalize(second));
    });

  const options: ActivityFilterOptions = {
    repositories,
    labels,
    users,
    issueTypes,
    milestones,
    issuePriorities: [...ISSUE_PRIORITY_VALUES],
    issueWeights: [...ISSUE_WEIGHT_VALUES],
  };

  const counts: FilterOptionsCounts = {
    repositories: repositories.length,
    labels: labels.length,
    users: users.length,
    issueTypes: issueTypes.length,
    milestones: milestones.length,
    total:
      repositories.length +
      labels.length +
      users.length +
      issueTypes.length +
      milestones.length,
  };

  return { options, counts };
}

function mapCachedLinkedPullRequests(
  value: unknown,
): ActivityLinkedPullRequest[] | null {
  const raw = parseJson<unknown[]>(value);
  if (!Array.isArray(raw)) {
    return null;
  }

  const entries: ActivityLinkedPullRequest[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const data = entry as Record<string, unknown>;
    const status = normalizePullRequestStatus(data.status);
    entries.push({
      id: `${data.id ?? ""}`,
      number:
        typeof data.number === "number"
          ? data.number
          : Number.isFinite(data.number)
            ? Number(data.number)
            : null,
      title: typeof data.title === "string" ? data.title : null,
      state: typeof data.state === "string" ? data.state : null,
      status,
      repositoryNameWithOwner:
        typeof data.repositoryNameWithOwner === "string"
          ? data.repositoryNameWithOwner
          : null,
      url: typeof data.url === "string" ? data.url : null,
      mergedAt: toIso(data.mergedAt),
      closedAt: toIso(data.closedAt),
      updatedAt: toIso(data.updatedAt),
    });
  });

  return entries;
}

function mapCachedLinkedIssues(value: unknown): ActivityLinkedIssue[] | null {
  const raw = parseJson<unknown[]>(value);
  if (!Array.isArray(raw)) {
    return null;
  }

  const entries: ActivityLinkedIssue[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const data = entry as Record<string, unknown>;
    entries.push({
      id: `${data.id ?? ""}`,
      number:
        typeof data.number === "number"
          ? data.number
          : Number.isFinite(data.number)
            ? Number(data.number)
            : null,
      title: typeof data.title === "string" ? data.title : null,
      state: typeof data.state === "string" ? data.state : null,
      repositoryNameWithOwner:
        typeof data.repositoryNameWithOwner === "string"
          ? data.repositoryNameWithOwner
          : null,
      url: typeof data.url === "string" ? data.url : null,
    });
  });

  return entries;
}

async function getCacheState(cacheKey: string): Promise<CacheStatus | null> {
  const result = await query<CacheStateRow>(
    `SELECT cache_key, generated_at, sync_run_id, item_count, metadata
       FROM activity_cache_state
       WHERE cache_key = $1
       LIMIT 1`,
    [cacheKey],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata:
      (parseJson<Record<string, unknown>>(row.metadata) as Record<
        string,
        unknown
      > | null) ?? null,
  };
}

async function resolveLastSuccessfulSyncAt(): Promise<string | null> {
  const config = await getSyncConfig();
  return config?.last_successful_sync_at ?? null;
}

function isCacheFresh(
  state: CacheStatus | null,
  lastSuccessfulSyncAt: string | null,
): boolean {
  if (!state?.generated_at) {
    return false;
  }

  const generatedMs = Date.parse(state.generated_at);
  if (!Number.isFinite(generatedMs)) {
    return false;
  }

  if (!lastSuccessfulSyncAt) {
    return true;
  }

  const lastSyncMs = Date.parse(lastSuccessfulSyncAt);
  if (!Number.isFinite(lastSyncMs)) {
    return false;
  }

  return generatedMs >= lastSyncMs;
}

function logCacheFallback(
  cacheKey: string,
  reason: string,
  state: CacheStatus | null,
  lastSuccessfulSyncAt: string | null,
) {
  console.warn("[activity-cache] Falling back to live query", {
    cacheKey,
    reason,
    cacheGeneratedAt: state?.generated_at ?? null,
    cacheSyncRunId: state?.sync_run_id ?? null,
    cacheItemCount: state?.item_count ?? null,
    cacheMetadata: state?.metadata ?? null,
    lastSuccessfulSyncAt,
  });
}

function toIso(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.error("[activity-cache] Failed to parse JSON payload", error);
      return null;
    }
  }
  if (typeof value === "object") {
    return value as T;
  }
  return null;
}

function normalizePullRequestStatus(
  value: unknown,
): ActivityLinkedPullRequestStatus {
  if (value === "open" || value === "closed" || value === "merged") {
    return value;
  }
  return "open";
}

async function queryLinkedPullRequestsDirect(
  issueIds: readonly string[],
): Promise<Map<string, ActivityLinkedPullRequest[]>> {
  const ids = Array.from(issueIds);
  if (!ids.length) {
    return new Map();
  }

  const result = await query<{
    issue_id: string;
    pull_request_id: string;
    pull_request_number: number | null;
    pull_request_title: string | null;
    pull_request_state: string | null;
    pull_request_merged: boolean | null;
    pull_request_closed_at: string | null;
    pull_request_merged_at: string | null;
    pull_request_updated_at: string | null;
    pull_request_url: string | null;
    pull_request_repository_name_with_owner: string | null;
  }>(
    `SELECT
       pri.issue_id,
       pr.id AS pull_request_id,
       pr.number AS pull_request_number,
       pr.title AS pull_request_title,
       pr.state AS pull_request_state,
       pr.merged AS pull_request_merged,
       pr.github_closed_at AS pull_request_closed_at,
       pr.github_merged_at AS pull_request_merged_at,
       pr.github_updated_at AS pull_request_updated_at,
       pr.data->>'url' AS pull_request_url,
       repo.name_with_owner AS pull_request_repository_name_with_owner
     FROM pull_request_issues pri
     JOIN pull_requests pr ON pr.id = pri.pull_request_id
     JOIN repositories repo ON repo.id = pr.repository_id
     WHERE pri.issue_id = ANY($1::text[])
     ORDER BY pri.issue_id, pr.github_updated_at DESC NULLS LAST, pr.github_created_at DESC`,
    [ids],
  );

  const map = new Map<string, ActivityLinkedPullRequest[]>();
  result.rows.forEach((row) => {
    const status = resolveLinkedPullRequestStatus(
      row.pull_request_merged,
      row.pull_request_state,
      row.pull_request_closed_at,
    );
    const entry: ActivityLinkedPullRequest = {
      id: row.pull_request_id,
      number: row.pull_request_number,
      title: row.pull_request_title,
      state: row.pull_request_state,
      status,
      repositoryNameWithOwner: row.pull_request_repository_name_with_owner,
      url: row.pull_request_url,
      mergedAt: toIso(row.pull_request_merged_at),
      closedAt: toIso(row.pull_request_closed_at),
      updatedAt: toIso(row.pull_request_updated_at),
    };
    const list = map.get(row.issue_id);
    if (list) {
      list.push(entry);
    } else {
      map.set(row.issue_id, [entry]);
    }
  });

  return map;
}

async function queryLinkedIssuesDirect(
  pullRequestIds: readonly string[],
): Promise<Map<string, ActivityLinkedIssue[]>> {
  const ids = Array.from(pullRequestIds);
  if (!ids.length) {
    return new Map();
  }

  const result = await query<{
    pull_request_id: string;
    issue_id: string;
    issue_number: number | null;
    issue_title: string | null;
    issue_state: string | null;
    issue_url: string | null;
    issue_repository_name_with_owner: string | null;
  }>(
    `SELECT
       pri.pull_request_id,
       COALESCE(i.id, pri.issue_id) AS issue_id,
       COALESCE(i.number, pri.issue_number) AS issue_number,
       COALESCE(i.title, pri.issue_title) AS issue_title,
       COALESCE(i.state, pri.issue_state) AS issue_state,
       COALESCE(i.data->>'url', pri.issue_url) AS issue_url,
       COALESCE(repo.name_with_owner, pri.issue_repository) AS issue_repository_name_with_owner
     FROM pull_request_issues pri
     LEFT JOIN issues i ON i.id = pri.issue_id
     LEFT JOIN repositories repo ON repo.id = i.repository_id
     WHERE pri.pull_request_id = ANY($1::text[])
     ORDER BY pri.pull_request_id, pri.updated_at DESC NULLS LAST`,
    [ids],
  );

  const map = new Map<string, ActivityLinkedIssue[]>();
  result.rows.forEach((row) => {
    const entry: ActivityLinkedIssue = {
      id: row.issue_id,
      number: row.issue_number,
      title: row.issue_title,
      state: row.issue_state,
      repositoryNameWithOwner: row.issue_repository_name_with_owner,
      url: row.issue_url,
    };
    const list = map.get(row.pull_request_id);
    if (list) {
      list.push(entry);
    } else {
      map.set(row.pull_request_id, [entry]);
    }
  });

  return map;
}

function resolveLinkedPullRequestStatus(
  merged: boolean | null,
  state: string | null,
  closedAt: string | null,
): ActivityLinkedPullRequestStatus {
  if (merged) {
    return "merged";
  }
  const lowered = state?.toLowerCase() ?? "";
  if (lowered === "closed" || closedAt) {
    return "closed";
  }
  if (lowered === "merged") {
    return "merged";
  }
  return "open";
}
