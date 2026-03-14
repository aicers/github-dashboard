import { normalizeProjectTarget } from "@/lib/activity/base-query";
import {
  getLinkedIssuesMap,
  getLinkedPullRequestsMap,
} from "@/lib/activity/cache";
import { parseIssueRaw, toIso, toIsoDate } from "@/lib/activity/data-utils";
import { getProjectFieldOverrides } from "@/lib/activity/project-field-store";
import {
  type ActivityRow,
  buildActivityItem,
} from "@/lib/activity/service-builders";
import {
  coerceArray,
  DEFAULT_THRESHOLDS,
  fetchRepositoryMaintainers,
  mapUser,
  mapUsers,
  resolveAttentionSets,
  toRawObject,
  toUserMap,
} from "@/lib/activity/service-utils";
import { getActivityStatusHistory } from "@/lib/activity/status-store";
import {
  extractProjectStatusEntries,
  mapIssueProjectStatus,
} from "@/lib/activity/status-utils";
import type {
  ActivityItemComment,
  ActivityItemDetail,
  ActivityLinkedIssue,
  ActivityReactionGroup,
  ActivityThresholds,
  ActivityUser,
  IssueProjectStatus,
} from "@/lib/activity/types";
import { loadCombinedHolidaySet } from "@/lib/dashboard/business-days";
import { normalizeOrganizationHolidayCodes } from "@/lib/dashboard/holiday-utils";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { getSyncConfig, getUserProfiles } from "@/lib/db/operations";
import { env } from "@/lib/env";

type CommentRow = {
  id: string;
  author_id: string | null;
  review_id: string | null;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  data: unknown;
};

type ReactionAggregateRow = {
  subject_id: string;
  content: string | null;
  count: number | string;
  reactor_ids: string[] | null;
};

function extractLinkedIssues(connection: unknown): ActivityLinkedIssue[] {
  if (!connection || typeof connection !== "object") {
    return [];
  }

  const nodes = (connection as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }

  const result: ActivityLinkedIssue[] = [];
  nodes.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (!id) {
      return;
    }

    const numberValue = record.number;
    let issueNumber: number | null = null;
    if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
      issueNumber = numberValue;
    } else if (typeof numberValue === "string") {
      const parsed = Number.parseInt(numberValue, 10);
      if (Number.isFinite(parsed)) {
        issueNumber = parsed;
      }
    }
    const title =
      typeof record.title === "string" && record.title.trim().length
        ? record.title
        : null;
    const state =
      typeof record.state === "string" && record.state.trim().length
        ? record.state
        : null;
    const url =
      typeof record.url === "string" && record.url.trim().length
        ? record.url
        : null;
    const repository =
      record.repository && typeof record.repository === "object"
        ? (record.repository as { nameWithOwner?: unknown })
        : null;
    const repositoryNameWithOwner =
      repository && typeof repository.nameWithOwner === "string"
        ? repository.nameWithOwner
        : null;

    result.push({
      id,
      number: issueNumber,
      title,
      state,
      repositoryNameWithOwner,
      url,
    });
  });

  return result;
}

export async function fetchJumpPage(
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
    `SELECT COUNT(*) AS count
     FROM activity_items AS items
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

export async function getActivityItemDetail(
  id: string,
  options?: { useMentionClassifier?: boolean },
): Promise<ActivityItemDetail | null> {
  await ensureSchema();

  const thresholds: Required<ActivityThresholds> = { ...DEFAULT_THRESHOLDS };
  const attentionSets = await resolveAttentionSets(thresholds, {
    useMentionClassifier: options?.useMentionClassifier ?? true,
  });
  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);
  const config = await getSyncConfig();
  const organizationHolidayCodes = normalizeOrganizationHolidayCodes(config);
  const organizationHolidaySet = await loadCombinedHolidaySet(
    organizationHolidayCodes,
  );

  const result = await query<ActivityRow>(
    `SELECT items.*
     FROM activity_items AS items
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
  const now = new Date();
  const issueIds = row.item_type === "issue" ? [row.id] : [];
  const pullRequestIds = row.item_type === "pull_request" ? [row.id] : [];
  const [
    activityStatusHistory,
    projectOverrides,
    linkedPullRequestsMap,
    linkedIssuesMap,
    repositoryMaintainers,
  ] = await Promise.all([
    getActivityStatusHistory(issueIds),
    getProjectFieldOverrides(issueIds),
    getLinkedPullRequestsMap(issueIds),
    getLinkedIssuesMap(pullRequestIds),
    fetchRepositoryMaintainers(
      row.repository_id && row.repository_id.length > 0
        ? [row.repository_id]
        : [],
    ),
  ]);
  const item = buildActivityItem(
    row,
    users,
    attentionSets,
    targetProject,
    organizationHolidaySet,
    now,
    projectOverrides,
    activityStatusHistory,
    linkedIssuesMap,
    linkedPullRequestsMap,
    repositoryMaintainers,
  );
  const rawIssue = parseIssueRaw(row.raw_data);
  let todoStatusTimes: Partial<
    Record<IssueProjectStatus, string | null>
  > | null = null;
  let activityStatusTimes: Partial<
    Record<IssueProjectStatus, string | null>
  > | null = null;

  if (row.item_type === "issue") {
    const todoMap: Partial<Record<IssueProjectStatus, string | null>> = {};
    const entries = extractProjectStatusEntries(rawIssue, targetProject);
    entries.forEach((entry) => {
      const mapped = mapIssueProjectStatus(entry.status);
      if (
        mapped === "todo" ||
        mapped === "in_progress" ||
        mapped === "done" ||
        mapped === "canceled"
      ) {
        const iso = toIso(entry.occurredAt);
        if (iso) {
          todoMap[mapped] = iso;
        }
      }
    });
    if (Object.keys(todoMap).length > 0) {
      todoStatusTimes = todoMap;
    }

    const activityEvents = activityStatusHistory.get(row.id) ?? [];
    const activityMap: Partial<Record<IssueProjectStatus, string | null>> = {};
    activityEvents.forEach((event) => {
      if (
        event.status === "todo" ||
        event.status === "in_progress" ||
        event.status === "done" ||
        event.status === "canceled"
      ) {
        const iso = toIso(event.occurredAt);
        if (iso) {
          activityMap[event.status] = iso;
        }
      }
    });
    if (Object.keys(activityMap).length > 0) {
      activityStatusTimes = activityMap;
    }
  }

  const rawObject = toRawObject(row.raw_data);
  const commentTargetColumn =
    row.item_type === "pull_request" ? "pull_request_id" : "issue_id";
  const commentsResult = await query<CommentRow>(
    `SELECT id, author_id, review_id, github_created_at, github_updated_at, data
       FROM comments
       WHERE ${commentTargetColumn} = $1
       ORDER BY github_created_at ASC, id ASC`,
    [row.id],
  );
  const commentIds = commentsResult.rows.map((comment) => comment.id);
  const reactionTargetIds = new Set<string>([row.id, ...commentIds]);

  let reactionRows: ReactionAggregateRow[] = [];
  if (reactionTargetIds.size > 0) {
    const reactionResult = await query<ReactionAggregateRow>(
      `SELECT
         subject_id,
         content,
         COUNT(*)::int AS count,
         ARRAY_AGG(user_id) FILTER (WHERE user_id IS NOT NULL) AS reactor_ids
       FROM reactions
       WHERE subject_id = ANY($1::text[])
       GROUP BY subject_id, content`,
      [Array.from(reactionTargetIds)],
    );
    reactionRows = reactionResult.rows;
  }

  if (reactionRows.length > 0) {
    const reactorIdSet = new Set<string>();
    reactionRows.forEach((reactionRow) => {
      coerceArray(reactionRow.reactor_ids).forEach((rid) => {
        if (rid) {
          reactorIdSet.add(rid);
        }
      });
    });
    const missingReactorIds = Array.from(reactorIdSet).filter(
      (rid) => rid && !users.has(rid),
    );
    if (missingReactorIds.length > 0) {
      const extraProfiles = await getUserProfiles(missingReactorIds);
      extraProfiles.forEach((profile) => {
        users.set(profile.id, profile);
      });
    }
  }

  const reactionMap = new Map<string, ActivityReactionGroup[]>();
  reactionRows.forEach((reactionRow) => {
    const subjectId = reactionRow.subject_id;
    const count =
      typeof reactionRow.count === "number"
        ? reactionRow.count
        : Number.parseInt(String(reactionRow.count), 10);
    const group: ActivityReactionGroup = {
      content: reactionRow.content ?? null,
      count: Number.isNaN(count) ? 0 : count,
      users: mapUsers(coerceArray(reactionRow.reactor_ids), users),
    };
    const existing = reactionMap.get(subjectId);
    if (existing) {
      existing.push(group);
    } else {
      reactionMap.set(subjectId, [group]);
    }
  });

  reactionMap.forEach((groups, key) => {
    const sorted = groups.slice().sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      const left = (a.content ?? "").toString();
      const right = (b.content ?? "").toString();
      return left.localeCompare(right);
    });
    reactionMap.set(key, sorted);
  });

  const itemReactions = reactionMap.get(row.id) ?? [];

  const comments: ActivityItemComment[] = commentsResult.rows.map(
    (commentRow) => {
      const rawComment = toRawObject(commentRow.data);
      const rawAuthor =
        rawComment &&
        typeof (rawComment as { author?: unknown }).author === "object"
          ? ((rawComment as { author?: Record<string, unknown> }).author ??
            null)
          : null;
      const rawAuthorId =
        rawAuthor && typeof rawAuthor.id === "string" ? rawAuthor.id : null;
      const resolvedAuthorId = commentRow.author_id ?? rawAuthorId ?? null;

      let author: ActivityUser | null = null;
      if (resolvedAuthorId) {
        const mapped = mapUser(resolvedAuthorId, users);
        if (mapped) {
          author = {
            id: mapped.id,
            login:
              mapped.login ??
              (rawAuthor && typeof rawAuthor.login === "string"
                ? rawAuthor.login
                : null),
            name:
              mapped.name ??
              (rawAuthor && typeof rawAuthor.name === "string"
                ? rawAuthor.name
                : null),
            avatarUrl:
              mapped.avatarUrl ??
              (rawAuthor && typeof rawAuthor.avatarUrl === "string"
                ? rawAuthor.avatarUrl
                : null),
          };
        }
      } else if (rawAuthor) {
        author = {
          id:
            typeof rawAuthor.id === "string"
              ? rawAuthor.id
              : `anon-${commentRow.id}`,
          login: typeof rawAuthor.login === "string" ? rawAuthor.login : null,
          name: typeof rawAuthor.name === "string" ? rawAuthor.name : null,
          avatarUrl:
            typeof rawAuthor.avatarUrl === "string"
              ? rawAuthor.avatarUrl
              : null,
        };
      }

      const body =
        rawComment &&
        typeof (rawComment as { body?: unknown }).body === "string"
          ? ((rawComment as { body: string }).body ?? null)
          : rawComment &&
              typeof (rawComment as { bodyText?: unknown }).bodyText ===
                "string"
            ? ((rawComment as { bodyText: string }).bodyText ?? null)
            : null;

      const bodyHtml =
        rawComment &&
        typeof (rawComment as { bodyHTML?: unknown }).bodyHTML === "string"
          ? ((rawComment as { bodyHTML: string }).bodyHTML ?? null)
          : rawComment &&
              typeof (rawComment as { bodyHtml?: unknown }).bodyHtml ===
                "string"
            ? ((rawComment as { bodyHtml: string }).bodyHtml ?? null)
            : null;

      const replyTo =
        rawComment &&
        typeof (rawComment as { replyTo?: unknown }).replyTo === "object"
          ? ((rawComment as { replyTo?: { id?: string | null } }).replyTo ??
            null)
          : null;
      const replyToId =
        replyTo && typeof replyTo.id === "string" ? replyTo.id : null;

      const url =
        rawComment && typeof (rawComment as { url?: unknown }).url === "string"
          ? ((rawComment as { url: string }).url ?? null)
          : null;
      const isAnswer =
        rawComment &&
        typeof (rawComment as { isAnswer?: unknown }).isAnswer === "boolean"
          ? !!(rawComment as { isAnswer?: boolean }).isAnswer
          : false;

      return {
        id: commentRow.id,
        author,
        body,
        bodyHtml,
        createdAt: toIsoDate(commentRow.github_created_at),
        updatedAt: toIsoDate(commentRow.github_updated_at),
        url,
        reviewId:
          typeof commentRow.review_id === "string"
            ? commentRow.review_id
            : null,
        replyToId,
        isAnswer,
        reactions: reactionMap.get(commentRow.id) ?? [],
      } satisfies ActivityItemComment;
    },
  );

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

  const parentIssues = extractLinkedIssues(
    rawObject && typeof rawObject === "object"
      ? (rawObject as { trackedInIssues?: unknown }).trackedInIssues
      : undefined,
  );
  const subIssues = extractLinkedIssues(
    rawObject && typeof rawObject === "object"
      ? (rawObject as { trackedIssues?: unknown }).trackedIssues
      : undefined,
  );

  return {
    item,
    body,
    bodyHtml,
    raw: rawObject ?? row.raw_data ?? null,
    parentIssues,
    subIssues,
    comments,
    commentCount: comments.length,
    linkedPullRequests: item.linkedPullRequests,
    linkedIssues: item.linkedIssues,
    reactions: itemReactions,
    todoStatusTimes: todoStatusTimes ?? undefined,
    activityStatusTimes: activityStatusTimes ?? undefined,
  };
}
