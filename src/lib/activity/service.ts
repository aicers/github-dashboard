import type {
  ActivityAttentionFilter,
  ActivityAttentionFlags,
  ActivityFilterOptions,
  ActivityItem,
  ActivityItemDetail,
  ActivityLabel,
  ActivityListParams,
  ActivityListResult,
  ActivityStatusFilter,
  ActivityThresholds,
  ActivityUser,
} from "@/lib/activity/types";
import { getAttentionInsights } from "@/lib/dashboard/attention";
import {
  differenceInBusinessDays,
  differenceInBusinessDaysOrNull,
  HOLIDAY_SET,
} from "@/lib/dashboard/business-days";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { getSyncConfig, getUserProfiles } from "@/lib/db/operations";
import { env } from "@/lib/env";

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

const DEFAULT_THRESHOLDS: Required<ActivityThresholds> = {
  unansweredMentionDays: 5,
  reviewRequestDays: 5,
  stalePrDays: 20,
  idlePrDays: 10,
  backlogIssueDays: 40,
  stalledIssueDays: 20,
};

type ActivityRow = {
  item_type: "issue" | "pull_request" | "discussion";
  id: string;
  number: number | null;
  title: string | null;
  state: string | null;
  status: ActivityStatusFilter;
  url: string | null;
  repository_id: string | null;
  repository_name: string | null;
  repository_name_with_owner: string | null;
  author_id: string | null;
  assignee_ids: string[] | null;
  reviewer_ids: string[] | null;
  mentioned_ids: string[] | null;
  commenter_ids: string[] | null;
  reactor_ids: string[] | null;
  label_keys: string[] | null;
  label_names: string[] | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  is_merged: boolean | null;
  raw_data: unknown;
  project_history: unknown;
  body_text: string | null;
  total_count: string | number;
};

type AttentionSets = {
  unansweredMentions: Set<string>;
  reviewRequests: Set<string>;
  stalePullRequests: Set<string>;
  idlePullRequests: Set<string>;
  backlogIssues: Set<string>;
  stalledIssues: Set<string>;
};

type IssueRaw = {
  projectStatusHistory?: unknown;
};

type ProjectStatusEntry = {
  status: string;
  occurredAt: string;
};

function coerceArray(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toUserMap(profiles: ActivityUser[]) {
  const map = new Map<string, ActivityUser>();
  profiles.forEach((profile) => {
    map.set(profile.id, profile);
  });
  return map;
}

function mapUser(id: string | null, users: Map<string, ActivityUser>) {
  if (!id) {
    return null;
  }

  const profile = users.get(id);
  if (profile) {
    return profile;
  }

  return {
    id,
    login: null,
    name: null,
    avatarUrl: null,
  };
}

function mapUsers(ids: string[], users: Map<string, ActivityUser>) {
  const seen = new Set<string>();
  const result: ActivityUser[] = [];
  ids.forEach((id) => {
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    const user = mapUser(id, users);
    if (user) {
      result.push(user);
    }
  });
  return result;
}

function buildLabels(row: ActivityRow): ActivityLabel[] {
  const keys = coerceArray(row.label_keys);
  const names = coerceArray(row.label_names);
  const repositoryId = row.repository_id ?? "";
  const repoNameWithOwner = row.repository_name_with_owner ?? null;

  return keys.map((key, index) => ({
    key,
    name: names[index] ?? key.split(":").pop() ?? key,
    repositoryId,
    repositoryNameWithOwner: repoNameWithOwner,
  }));
}

function normalizeText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

function matchProject(projectName: unknown, target: string | null) {
  if (!target) {
    return false;
  }

  if (typeof projectName !== "string") {
    return false;
  }

  return normalizeText(projectName) === target;
}

function isInProgressStatus(status: string) {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("progress") ||
    normalized === "doing" ||
    normalized === "in-progress"
  );
}

function isDoneStatus(status: string) {
  const normalized = status.toLowerCase();
  return (
    normalized === "done" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "finished" ||
    normalized === "closed"
  );
}

function parseIssueRaw(data: unknown): IssueRaw | null {
  if (!data) {
    return null;
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        return parsed as IssueRaw;
      }
    } catch {
      return null;
    }
  }

  if (typeof data === "object") {
    return data as IssueRaw;
  }

  return null;
}

function extractProjectStatusEntries(
  raw: IssueRaw | null,
  targetProject: string | null,
): ProjectStatusEntry[] {
  if (!raw) {
    return [];
  }

  const entries = new Map<number, ProjectStatusEntry>();
  const history = Array.isArray(
    (raw as Record<string, unknown>).projectStatusHistory,
  )
    ? ((raw as Record<string, unknown>).projectStatusHistory as unknown[])
    : [];

  history.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    if (!matchProject(record.projectTitle, targetProject)) {
      return;
    }

    const status =
      typeof record.status === "string" ? record.status.trim() : null;
    const occurredAt =
      typeof record.occurredAt === "string" ? record.occurredAt : null;

    if (!status || !occurredAt) {
      return;
    }

    const timestamp = Date.parse(occurredAt);
    if (Number.isNaN(timestamp)) {
      return;
    }

    entries.set(timestamp, { status, occurredAt });
  });

  return Array.from(entries.entries())
    .sort((first, second) => first[0] - second[0])
    .map(([, value]) => value);
}

function extractWorkTimestamps(
  raw: IssueRaw | null,
  targetProject: string | null,
) {
  const entries = extractProjectStatusEntries(raw, targetProject);
  let startedAt: string | null = null;
  let completedAt: string | null = null;

  entries.forEach((entry) => {
    if (!startedAt && isInProgressStatus(entry.status)) {
      startedAt = entry.occurredAt;
    }

    if (!completedAt && isDoneStatus(entry.status)) {
      completedAt = entry.occurredAt;
    }
  });

  return { startedAt, completedAt };
}

async function resolveAttentionSets(
  thresholds: Required<ActivityThresholds>,
): Promise<AttentionSets> {
  const insights = await getAttentionInsights();
  const unansweredMentions = new Set<string>();
  const reviewRequests = new Set<string>();
  const stalePullRequests = new Set<string>();
  const idlePullRequests = new Set<string>();
  const backlogIssues = new Set<string>();
  const stalledIssues = new Set<string>();

  insights.unansweredMentions.forEach((item) => {
    if (item.waitingDays >= thresholds.unansweredMentionDays) {
      const id = item.container.id;
      if (id) {
        unansweredMentions.add(id);
      }
    }
  });

  insights.stuckReviewRequests.forEach((item) => {
    if (item.waitingDays >= thresholds.reviewRequestDays) {
      reviewRequests.add(item.pullRequest.id);
    }
  });

  insights.staleOpenPrs.forEach((item) => {
    if (item.ageDays >= thresholds.stalePrDays) {
      stalePullRequests.add(item.id);
    }
  });

  insights.idleOpenPrs.forEach((item) => {
    const inactivity = item.inactivityDays ?? 0;
    if (inactivity >= thresholds.idlePrDays) {
      idlePullRequests.add(item.id);
    }
  });

  insights.backlogIssues.forEach((item) => {
    if (item.ageDays >= thresholds.backlogIssueDays) {
      backlogIssues.add(item.id);
    }
  });

  insights.stalledInProgressIssues.forEach((item) => {
    const inProgressAge = item.inProgressAgeDays ?? 0;
    if (inProgressAge >= thresholds.stalledIssueDays) {
      stalledIssues.add(item.id);
    }
  });

  return {
    unansweredMentions,
    reviewRequests,
    stalePullRequests,
    idlePullRequests,
    backlogIssues,
    stalledIssues,
  };
}

function collectAttentionFilterIds(
  filters: ActivityAttentionFilter[] | undefined,
  sets: AttentionSets,
) {
  if (!filters?.length) {
    return null;
  }

  const union = new Set<string>();
  filters.forEach((filter) => {
    switch (filter) {
      case "unanswered_mentions":
        for (const id of sets.unansweredMentions) {
          union.add(id);
        }
        break;
      case "review_requests_pending":
        for (const id of sets.reviewRequests) {
          union.add(id);
        }
        break;
      case "pr_open_too_long":
        for (const id of sets.stalePullRequests) {
          union.add(id);
        }
        break;
      case "pr_inactive":
        for (const id of sets.idlePullRequests) {
          union.add(id);
        }
        break;
      case "issue_backlog":
        for (const id of sets.backlogIssues) {
          union.add(id);
        }
        break;
      case "issue_stalled":
        for (const id of sets.stalledIssues) {
          union.add(id);
        }
        break;
      default:
        break;
    }
  });

  return union.size ? Array.from(union) : [];
}

function toStatus(value: string | null): ActivityStatusFilter {
  if (value === "merged" || value === "closed" || value === "open") {
    return value;
  }

  return "open";
}

function toIso(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function coerceSearch(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildQueryFilters(
  params: ActivityListParams,
  attentionIds: string[] | null,
) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (attentionIds?.length === 0) {
    // No matches for attention filters; force empty result set.
    clauses.push("FALSE");
    return { clauses, values };
  }

  if (attentionIds && attentionIds.length > 0) {
    values.push(attentionIds);
    clauses.push(`items.id = ANY($${values.length}::text[])`);
  }

  if (params.types?.length) {
    values.push(params.types);
    clauses.push(`items.item_type = ANY($${values.length}::text[])`);
  }

  if (params.repositoryIds?.length) {
    values.push(params.repositoryIds);
    clauses.push(`items.repository_id = ANY($${values.length}::text[])`);
  }

  if (params.labelKeys?.length) {
    values.push(params.labelKeys);
    clauses.push(`items.label_keys && $${values.length}::text[]`);
  }

  if (params.authorIds?.length) {
    values.push(params.authorIds);
    clauses.push(`items.author_id = ANY($${values.length}::text[])`);
  }

  if (params.assigneeIds?.length) {
    values.push(params.assigneeIds);
    const assigneeIndex = values.length;
    clauses.push(
      `(items.item_type <> 'discussion' OR items.assignee_ids && $${assigneeIndex}::text[])`,
    );
  }

  if (params.reviewerIds?.length) {
    values.push(params.reviewerIds);
    const reviewerIndex = values.length;
    clauses.push(
      `(items.item_type <> 'pull_request' OR items.reviewer_ids && $${reviewerIndex}::text[])`,
    );
  }

  if (params.mentionedUserIds?.length) {
    values.push(params.mentionedUserIds);
    clauses.push(`items.mentioned_ids && $${values.length}::text[]`);
  }

  if (params.commenterIds?.length) {
    values.push(params.commenterIds);
    clauses.push(`items.commenter_ids && $${values.length}::text[]`);
  }

  if (params.reactorIds?.length) {
    values.push(params.reactorIds);
    clauses.push(`items.reactor_ids && $${values.length}::text[]`);
  }

  if (params.statuses?.length) {
    const statuses = params.statuses;
    const withoutMerged = statuses.filter((status) => status !== "merged");

    if (withoutMerged.length === statuses.length) {
      values.push(statuses);
      clauses.push(`items.status = ANY($${values.length}::text[])`);
    } else {
      values.push(statuses);
      const mergedIndex = values.length;

      if (withoutMerged.length) {
        values.push(withoutMerged);
        clauses.push(
          `((items.item_type = 'pull_request' AND items.status = ANY($${mergedIndex}::text[])) OR (items.item_type <> 'pull_request' AND items.status = ANY($${values.length}::text[])))`,
        );
      } else {
        clauses.push(
          `items.item_type = 'pull_request' AND items.status = ANY($${mergedIndex}::text[])`,
        );
      }
    }
  }

  const search = coerceSearch(params.search);
  if (search) {
    const pattern = `%${search}%`;
    values.push(pattern);
    const patternIndex = values.length;
    values.push(pattern);
    const commentIndex = values.length;
    clauses.push(
      `(items.title ILIKE $${patternIndex} OR items.body_text ILIKE $${patternIndex} OR EXISTS (
         SELECT 1 FROM comments c
         WHERE (
           (items.item_type IN ('issue', 'discussion') AND c.issue_id = items.id) OR
           (items.item_type = 'pull_request' AND c.pull_request_id = items.id)
         )
         AND c.data->>'body' ILIKE $${commentIndex}
       ))`,
    );
  }

  return { clauses, values };
}

const BASE_QUERY = /* sql */ `
WITH issue_items AS (
  SELECT
    CASE
      WHEN LOWER(COALESCE(i.data->>'__typename', '')) = 'discussion'
        OR POSITION('/discussions/' IN COALESCE(i.data->>'url', '')) > 0
        THEN 'discussion'
      ELSE 'issue'
    END AS item_type,
    i.id,
    i.number,
    i.title,
    i.state,
    i.data->>'url' AS url,
    i.repository_id,
    repo.name AS repository_name,
    repo.name_with_owner AS repository_name_with_owner,
    i.author_id,
    COALESCE(assignees.assignee_ids, ARRAY[]::text[]) AS assignee_ids,
    ARRAY[]::text[] AS reviewer_ids,
    COALESCE(mentions.mentioned_ids, ARRAY[]::text[]) AS mentioned_ids,
    COALESCE(commenters.commenter_ids, ARRAY[]::text[]) AS commenter_ids,
    COALESCE(reactors.reactor_ids, ARRAY[]::text[]) AS reactor_ids,
    COALESCE(labels.label_keys, ARRAY[]::text[]) AS label_keys,
    COALESCE(labels.label_names, ARRAY[]::text[]) AS label_names,
    i.github_created_at AS created_at,
    i.github_updated_at AS updated_at,
    i.github_closed_at AS closed_at,
    NULL::timestamptz AS merged_at,
    FALSE AS is_merged,
    i.data AS raw_data,
    COALESCE(i.data->'projectStatusHistory', '[]'::jsonb) AS project_history,
    COALESCE(i.data->>'body', '') AS body_text
  FROM issues i
  JOIN repositories repo ON repo.id = i.repository_id
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT node->>'id') FILTER (WHERE node->>'id' IS NOT NULL) AS assignee_ids
    FROM jsonb_array_elements(COALESCE(i.data->'assignees'->'nodes', '[]'::jsonb)) AS node
  ) assignees ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT CONCAT(repo.name_with_owner, ':', label_node->>'name')) FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_keys,
      ARRAY_AGG(DISTINCT label_node->>'name') FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_names
    FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
  ) labels ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT c.author_id) FILTER (WHERE c.author_id IS NOT NULL) AS commenter_ids
    FROM comments c
    WHERE c.issue_id = i.id
  ) commenters ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS mentioned_ids
    FROM comments c
    CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
    LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
    WHERE c.issue_id = i.id
  ) mentions ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL) AS reactor_ids
    FROM reactions r
    WHERE r.subject_type IN ('Issue', 'Discussion') AND r.subject_id = i.id
  ) reactors ON TRUE
),
pr_items AS (
  SELECT
    'pull_request' AS item_type,
    pr.id,
    pr.number,
    pr.title,
    pr.state,
    pr.data->>'url' AS url,
    pr.repository_id,
    repo.name AS repository_name,
    repo.name_with_owner AS repository_name_with_owner,
    pr.author_id,
    COALESCE(assignees.assignee_ids, ARRAY[]::text[]) AS assignee_ids,
    COALESCE(reviewers.reviewer_ids, ARRAY[]::text[]) AS reviewer_ids,
    COALESCE(mentions.mentioned_ids, ARRAY[]::text[]) AS mentioned_ids,
    COALESCE(commenters.commenter_ids, ARRAY[]::text[]) AS commenter_ids,
    COALESCE(reactors.reactor_ids, ARRAY[]::text[]) AS reactor_ids,
    COALESCE(labels.label_keys, ARRAY[]::text[]) AS label_keys,
    COALESCE(labels.label_names, ARRAY[]::text[]) AS label_names,
    pr.github_created_at AS created_at,
    pr.github_updated_at AS updated_at,
    pr.github_closed_at AS closed_at,
    pr.github_merged_at AS merged_at,
    COALESCE(pr.merged, FALSE) AS is_merged,
    pr.data AS raw_data,
    '[]'::jsonb AS project_history,
    COALESCE(pr.data->>'body', '') AS body_text
  FROM pull_requests pr
  JOIN repositories repo ON repo.id = pr.repository_id
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT node->>'id') FILTER (WHERE node->>'id' IS NOT NULL) AS assignee_ids
    FROM jsonb_array_elements(COALESCE(pr.data->'assignees'->'nodes', '[]'::jsonb)) AS node
  ) assignees ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT reviewer_id) FILTER (WHERE reviewer_id IS NOT NULL) AS requested_reviewers
    FROM review_requests
    WHERE pull_request_id = pr.id AND removed_at IS NULL
  ) requested ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT author_id) FILTER (WHERE author_id IS NOT NULL) AS review_authors
    FROM reviews
    WHERE pull_request_id = pr.id
  ) review_authors ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS reviewer_ids
    FROM unnest(
      COALESCE(requested.requested_reviewers, ARRAY[]::text[]) ||
      COALESCE(review_authors.review_authors, ARRAY[]::text[])
    ) AS user_id
  ) reviewers ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT CONCAT(repo.name_with_owner, ':', label_node->>'name')) FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_keys,
      ARRAY_AGG(DISTINCT label_node->>'name') FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_names
    FROM jsonb_array_elements(COALESCE(pr.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
  ) labels ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT c.author_id) FILTER (WHERE c.author_id IS NOT NULL) AS commenter_ids
    FROM comments c
    WHERE c.pull_request_id = pr.id
  ) commenters ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS mentioned_ids
    FROM comments c
    CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
    LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
    WHERE c.pull_request_id = pr.id
  ) mentions ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL) AS reactor_ids
    FROM reactions r
    WHERE r.subject_type = 'PullRequest' AND r.subject_id = pr.id
  ) reactors ON TRUE
),
combined AS (
  SELECT
    item_type,
    id,
    number,
    title,
    state,
    url,
    repository_id,
    repository_name,
    repository_name_with_owner,
    author_id,
    assignee_ids,
    reviewer_ids,
    mentioned_ids,
    commenter_ids,
    reactor_ids,
    label_keys,
    label_names,
    created_at,
    updated_at,
    closed_at,
    merged_at,
    is_merged,
    raw_data,
    project_history,
    body_text,
    CASE
      WHEN item_type = 'pull_request' AND is_merged THEN 'merged'
      WHEN closed_at IS NOT NULL OR LOWER(state) = 'closed' THEN 'closed'
      ELSE 'open'
    END AS status
  FROM issue_items
  UNION ALL
  SELECT
    item_type,
    id,
    number,
    title,
    state,
    url,
    repository_id,
    repository_name,
    repository_name_with_owner,
    author_id,
    assignee_ids,
    reviewer_ids,
    mentioned_ids,
    commenter_ids,
    reactor_ids,
    label_keys,
    label_names,
    created_at,
    updated_at,
    closed_at,
    merged_at,
    is_merged,
    raw_data,
    project_history,
    body_text,
    CASE
      WHEN is_merged THEN 'merged'
      WHEN closed_at IS NOT NULL OR LOWER(state) = 'closed' THEN 'closed'
      ELSE 'open'
    END AS status
  FROM pr_items
)
`;

async function fetchJumpPage(
  filters: string[],
  values: unknown[],
  perPage: number,
  jumpToDate: string,
) {
  const date = new Date(jumpToDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const params = [...values, date.toISOString()];
  const predicate = filters.length
    ? ` AND ${filters.map((clause) => `(${clause})`).join(" AND ")}`
    : "";

  const result = await query<{ count: string }>(
    `${BASE_QUERY}
     SELECT COUNT(*) AS count
     FROM combined AS items
     WHERE 1 = 1${predicate}
       AND COALESCE(items.updated_at, items.created_at) > $${params.length}`,
    params,
  );

  const count = Number(result.rows[0]?.count ?? 0);
  if (!Number.isFinite(count) || count < 0) {
    return 1;
  }

  return Math.floor(count / perPage) + 1;
}

function buildAttentionFlags(
  row: ActivityRow,
  sets: AttentionSets,
  status: ActivityStatusFilter,
): ActivityAttentionFlags {
  if (row.item_type === "pull_request") {
    return {
      unansweredMention: sets.unansweredMentions.has(row.id),
      reviewRequestPending: sets.reviewRequests.has(row.id),
      staleOpenPr: status === "open" && sets.stalePullRequests.has(row.id),
      idlePr: status === "open" && sets.idlePullRequests.has(row.id),
      backlogIssue: false,
      stalledIssue: false,
    };
  }

  const backlog = sets.backlogIssues.has(row.id);
  const stalled = sets.stalledIssues.has(row.id);

  return {
    unansweredMention: sets.unansweredMentions.has(row.id),
    reviewRequestPending: false,
    staleOpenPr: false,
    idlePr: false,
    backlogIssue: backlog,
    stalledIssue: stalled,
  };
}

function buildActivityItem(
  row: ActivityRow,
  users: Map<string, ActivityUser>,
  sets: AttentionSets,
  targetProject: string | null,
  now: Date,
): ActivityItem {
  const status = toStatus(row.status);
  const labels = buildLabels(row);

  const author = mapUser(row.author_id, users);
  const assignees = mapUsers(coerceArray(row.assignee_ids), users);
  const reviewers = mapUsers(coerceArray(row.reviewer_ids), users);
  const mentionedUsers = mapUsers(coerceArray(row.mentioned_ids), users);
  const commenters = mapUsers(coerceArray(row.commenter_ids), users);
  const reactors = mapUsers(coerceArray(row.reactor_ids), users);

  const businessDaysOpen =
    status === "open"
      ? differenceInBusinessDays(row.created_at, now, HOLIDAY_SET)
      : differenceInBusinessDaysOrNull(row.created_at, now, HOLIDAY_SET);
  const businessDaysIdle = differenceInBusinessDaysOrNull(
    row.updated_at,
    now,
    HOLIDAY_SET,
  );

  let businessDaysSinceInProgress: number | null | undefined = null;
  let businessDaysInProgressOpen: number | null | undefined = null;

  if (row.item_type !== "pull_request") {
    const raw = parseIssueRaw(row.raw_data);
    const { startedAt } = extractWorkTimestamps(raw, targetProject);
    if (startedAt) {
      businessDaysSinceInProgress = differenceInBusinessDaysOrNull(
        startedAt,
        now,
        HOLIDAY_SET,
      );
      if (status !== "open" && row.closed_at) {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startedAt,
          new Date(row.closed_at),
          HOLIDAY_SET,
        );
      } else {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startedAt,
          now,
          HOLIDAY_SET,
        );
      }
    }
  }

  return {
    id: row.id,
    type: row.item_type,
    number: row.number,
    title: row.title,
    url: row.url,
    state: row.state,
    status,
    repository: row.repository_id
      ? {
          id: row.repository_id,
          name: row.repository_name,
          nameWithOwner: row.repository_name_with_owner,
        }
      : null,
    author,
    assignees,
    reviewers,
    mentionedUsers,
    commenters,
    reactors,
    labels,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    closedAt: toIso(row.closed_at),
    mergedAt: toIso(row.merged_at),
    businessDaysOpen,
    businessDaysIdle,
    businessDaysSinceInProgress,
    businessDaysInProgressOpen,
    attention: buildAttentionFlags(row, sets, status),
  };
}

function toRawObject(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
}

export async function getActivityFilterOptions(): Promise<ActivityFilterOptions> {
  await ensureSchema();

  const [repositoriesResult, labelsResult, usersResult, syncConfig] =
    await Promise.all([
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
      getSyncConfig(),
    ]);

  const repositories = repositoriesResult.rows.map((row) => ({
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

  const excludedUserIds = new Set<string>(
    Array.isArray(syncConfig?.excluded_user_ids)
      ? (syncConfig.excluded_user_ids as string[]).filter(
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

  return { repositories, labels, users };
}

export async function getActivityItems(
  params: ActivityListParams = {},
): Promise<ActivityListResult> {
  await ensureSchema();

  const thresholds: Required<ActivityThresholds> = {
    ...DEFAULT_THRESHOLDS,
    ...params.thresholds,
  };

  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, params.perPage ?? DEFAULT_PER_PAGE),
  );

  const attentionSets = await resolveAttentionSets(thresholds);
  const attentionIds = collectAttentionFilterIds(
    params.attention,
    attentionSets,
  );

  if (attentionIds && attentionIds.length === 0) {
    const config = await getSyncConfig();
    return {
      items: [],
      pageInfo: {
        page: 1,
        perPage,
        totalCount: 0,
        totalPages: 0,
      },
      lastSyncCompletedAt: toIso(config?.last_sync_completed_at ?? null),
      timezone:
        typeof config?.timezone === "string" && config.timezone.trim().length
          ? config.timezone
          : null,
    };
  }

  const { clauses, values } = buildQueryFilters(params, attentionIds);

  let page = Math.max(1, params.page ?? 1);

  if (params.jumpToDate) {
    const jumpPage = await fetchJumpPage(
      clauses,
      values,
      perPage,
      params.jumpToDate,
    );
    if (jumpPage && Number.isFinite(jumpPage) && jumpPage > 0) {
      page = jumpPage;
    }
  }

  const offset = (page - 1) * perPage;
  const predicate = clauses.length
    ? ` AND ${clauses.map((clause) => `(${clause})`).join(" AND ")}`
    : "";
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const queryParams = [...values, perPage, offset];

  const result = await query<ActivityRow>(
    `${BASE_QUERY}
     SELECT
       items.*,
       COUNT(*) OVER() AS total_count
     FROM combined AS items
     WHERE 1 = 1${predicate}
     ORDER BY items.updated_at DESC NULLS LAST, items.created_at DESC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    queryParams,
  );

  const rows = result.rows;
  const totalCount = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
  const totalPages =
    perPage > 0 ? Math.max(1, Math.ceil(totalCount / perPage)) : 1;

  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.author_id) {
      userIds.add(row.author_id);
    }
    for (const id of coerceArray(row.assignee_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.reviewer_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.mentioned_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.commenter_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.reactor_ids)) {
      userIds.add(id);
    }
  }

  const profiles = await getUserProfiles(Array.from(userIds));
  const users = toUserMap(profiles);

  const targetProject = normalizeText(env.TODO_PROJECT_NAME);
  const now = new Date();

  const items = rows.map((row) =>
    buildActivityItem(row, users, attentionSets, targetProject, now),
  );

  const config = await getSyncConfig();

  return {
    items,
    pageInfo: {
      page,
      perPage,
      totalCount,
      totalPages,
    },
    lastSyncCompletedAt: toIso(config?.last_sync_completed_at ?? null),
    timezone:
      typeof config?.timezone === "string" && config.timezone.trim().length
        ? config.timezone
        : null,
  };
}

export async function getActivityItemDetail(
  id: string,
): Promise<ActivityItemDetail | null> {
  await ensureSchema();

  const thresholds: Required<ActivityThresholds> = { ...DEFAULT_THRESHOLDS };
  const attentionSets = await resolveAttentionSets(thresholds);

  const result = await query<ActivityRow>(
    `${BASE_QUERY}
     SELECT items.*, 0::bigint AS total_count
     FROM combined AS items
     WHERE items.id = $1
     LIMIT 1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const userIds = new Set<string>();
  if (row.author_id) {
    userIds.add(row.author_id);
  }
  for (const value of coerceArray(row.assignee_ids)) {
    userIds.add(value);
  }
  for (const value of coerceArray(row.reviewer_ids)) {
    userIds.add(value);
  }
  for (const value of coerceArray(row.mentioned_ids)) {
    userIds.add(value);
  }
  for (const value of coerceArray(row.commenter_ids)) {
    userIds.add(value);
  }
  for (const value of coerceArray(row.reactor_ids)) {
    userIds.add(value);
  }

  const profiles = await getUserProfiles(Array.from(userIds));
  const users = toUserMap(profiles);
  const targetProject = normalizeText(env.TODO_PROJECT_NAME);
  const now = new Date();
  const item = buildActivityItem(row, users, attentionSets, targetProject, now);

  const rawObject = toRawObject(row.raw_data);
  const bodyCandidates: Array<string | null> = [];

  if (rawObject && typeof rawObject.body === "string") {
    bodyCandidates.push(rawObject.body);
  }

  if (
    rawObject &&
    typeof (rawObject as { bodyText?: unknown }).bodyText === "string"
  ) {
    bodyCandidates.push((rawObject as { bodyText: string }).bodyText);
  }

  if (
    rawObject &&
    typeof (rawObject as { bodyMarkdown?: unknown }).bodyMarkdown === "string"
  ) {
    bodyCandidates.push((rawObject as { bodyMarkdown: string }).bodyMarkdown);
  }

  if (typeof row.body_text === "string") {
    bodyCandidates.push(row.body_text);
  }

  const body =
    bodyCandidates.find(
      (value) => typeof value === "string" && value.trim().length > 0,
    ) ?? null;

  let bodyHtml: string | null = null;
  if (
    rawObject &&
    typeof (rawObject as { bodyHTML?: unknown }).bodyHTML === "string"
  ) {
    bodyHtml = (rawObject as { bodyHTML: string }).bodyHTML;
  } else if (
    rawObject &&
    typeof (rawObject as { bodyHtml?: unknown }).bodyHtml === "string"
  ) {
    bodyHtml = (rawObject as { bodyHtml: string }).bodyHtml;
  }

  return {
    item,
    body,
    bodyHtml,
    raw: rawObject ?? row.raw_data ?? null,
  };
}
