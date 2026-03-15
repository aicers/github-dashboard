import { createHash } from "node:crypto";
import { getProjectFieldOverrides } from "@/lib/activity/project-field-store";
import { getActivityStatusHistory } from "@/lib/activity/status-store";
import type { IssueProjectStatus } from "@/lib/activity/types";
import {
  applyProjectFieldOverridesToTarget,
  resolveIssueProjectSnapshot,
  resolveIssueStatusInfo,
} from "@/lib/dashboard/attention/project-fields";
import {
  addUserId,
  type Dataset,
  differenceInDays,
  type MentionDatasetItem,
  type MentionIssueSnapshotRow,
  type MentionRawItem,
  type MentionRow,
  type ResolvedManualDecision,
  UNANSWERED_MENTION_BUSINESS_DAYS,
} from "@/lib/dashboard/attention/types";
import { createPersonalHolidaySetLoader } from "@/lib/dashboard/personal-holidays";
import {
  buildMentionClassificationKey,
  fetchMentionClassifications,
  type MentionClassificationRecord,
  UNANSWERED_MENTION_PROMPT_VERSION,
} from "@/lib/dashboard/unanswered-mention-classifications";
import { query } from "@/lib/db/client";
import {
  getUserPreferencesByIds,
  listUserPersonalHolidaysByIds,
} from "@/lib/db/operations";
import type { HolidayCalendarCode } from "@/lib/holidays/constants";

function parseIssueRaw(data: unknown): {
  projectStatusHistory?: unknown;
  projectItems?: unknown;
  assignees?: { nodes?: unknown[] } | null;
} | null {
  if (!data) {
    return null;
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        return parsed as {
          projectStatusHistory?: unknown;
          projectItems?: unknown;
          assignees?: { nodes?: unknown[] } | null;
        };
      }
    } catch {
      return null;
    }
  }

  if (typeof data === "object") {
    return data as {
      projectStatusHistory?: unknown;
      projectItems?: unknown;
      assignees?: { nodes?: unknown[] } | null;
    };
  }

  return null;
}

function resolveManualDecision(
  record: MentionClassificationRecord | undefined,
): ResolvedManualDecision {
  if (!record) {
    return { value: null, isStale: false, appliedAt: null };
  }

  const manualValue = record.manualRequiresResponse;
  const manualAtIso = record.manualRequiresResponseAt;
  if (manualValue === null || !manualAtIso) {
    return { value: null, isStale: false, appliedAt: null };
  }

  const manualAt = new Date(manualAtIso);
  if (Number.isNaN(manualAt.getTime())) {
    return { value: manualValue, isStale: false, appliedAt: null };
  }

  const evaluatedAtIso = record.lastEvaluatedAt;
  if (evaluatedAtIso) {
    const evaluatedAt = new Date(evaluatedAtIso);
    if (!Number.isNaN(evaluatedAt.getTime())) {
      if (manualAt.getTime() < evaluatedAt.getTime()) {
        return {
          value: null,
          isStale: true,
          appliedAt: manualAt.toISOString(),
        };
      }
    }
  }

  return {
    value: manualValue,
    isStale: false,
    appliedAt: manualAt.toISOString(),
  };
}

export function extractCommentExcerpt(body: string | null) {
  if (!body) {
    return null;
  }

  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137)}...`;
}

export function computeCommentBodyHash(body: string | null | undefined) {
  return createHash("sha256")
    .update(body ?? "", "utf8")
    .digest("hex");
}

export async function fetchUnansweredMentionCandidates(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
  targetProject: string | null,
): Promise<MentionDatasetItem[]> {
  const result = await query<MentionRow>(
    `WITH mention_candidates AS (
       SELECT
         c.id AS comment_id,
         c.data->>'url' AS comment_url,
         c.github_created_at AS mentioned_at,
         c.data->>'body' AS comment_body,
         c.author_id AS comment_author_id,
         u.id AS mentioned_user_id,
         COALESCE(c.pull_request_id, review.pull_request_id) AS pr_id,
         c.issue_id,
         match.captures[1] AS mentioned_login
       FROM comments c
       LEFT JOIN reviews review ON review.id = c.review_id
       CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
       LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
       WHERE c.github_created_at <= $3::timestamptz - INTERVAL '2 days'
         AND u.id IS NOT NULL
         AND (c.author_id IS NULL OR c.author_id <> u.id)
         AND (c.author_id IS NULL OR NOT (c.author_id = ANY($2::text[])))
     )
     SELECT DISTINCT ON (mc.comment_id, mc.mentioned_user_id)
       mc.comment_id,
       mc.comment_url,
       mc.mentioned_at,
       mc.comment_body,
       mc.comment_author_id,
       mc.mentioned_user_id,
       mc.mentioned_login,
       mc.pr_id,
       pr.number AS pr_number,
       pr.title AS pr_title,
       pr.data->>'url' AS pr_url,
       pr.repository_id AS pr_repository_id,
       mc.issue_id,
       iss.number AS issue_number,
       iss.title AS issue_title,
       iss.data->>'url' AS issue_url,
        CASE
          WHEN mc.issue_id IS NULL THEN NULL
          WHEN LOWER(COALESCE(iss.data->>'__typename', '')) = 'discussion'
            OR POSITION('/discussions/' IN COALESCE(iss.data->>'url', '')) > 0
            THEN 'discussion'
          ELSE 'issue'
       END AS issue_type,
       COALESCE(pr.repository_id, iss.repository_id) AS repository_id,
       repo.name AS repository_name,
       repo.name_with_owner AS repository_name_with_owner,
       iss.data AS issue_data
     FROM mention_candidates mc
     LEFT JOIN pull_requests pr ON pr.id = mc.pr_id
     LEFT JOIN issues iss ON iss.id = mc.issue_id
     LEFT JOIN repositories repo ON repo.id = COALESCE(pr.repository_id, iss.repository_id)
     WHERE (mc.pr_id IS NOT NULL OR mc.issue_id IS NOT NULL)
       AND NOT (COALESCE(pr.repository_id, iss.repository_id) = ANY($1::text[]))
       AND NOT (mc.mentioned_user_id = ANY($2::text[]))
       AND NOT EXISTS (
         SELECT 1
         FROM comments c2
         WHERE c2.author_id = mc.mentioned_user_id
           AND c2.github_created_at >= mc.mentioned_at
           AND c2.id <> mc.comment_id
           AND (
             (mc.pr_id IS NOT NULL AND c2.pull_request_id = mc.pr_id) OR
             (mc.issue_id IS NOT NULL AND c2.issue_id = mc.issue_id)
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM reviews r2
         WHERE mc.pr_id IS NOT NULL
           AND r2.pull_request_id = mc.pr_id
           AND r2.author_id = mc.mentioned_user_id
           AND r2.github_submitted_at >= mc.mentioned_at
       )
       AND NOT EXISTS (
         SELECT 1
       FROM reactions reac
        WHERE reac.subject_id = mc.comment_id
          AND LOWER(reac.subject_type) IN (
            'issuecomment',
            'pullrequestreviewcomment',
            'commitcomment',
            'discussioncomment',
            'teamdiscussioncomment',
            'comment'
          )
          AND reac.user_id = mc.mentioned_user_id
          AND COALESCE(reac.github_created_at, NOW()) >= mc.mentioned_at
       )
       AND NOT (
         mc.issue_id IS NOT NULL
         AND (
           LOWER(COALESCE(iss.data->>'__typename', '')) = 'discussion'
           OR POSITION('/discussions/' IN COALESCE(iss.data->>'url', '')) > 0
         )
         AND iss.data->>'answerChosenAt' IS NOT NULL
         AND iss.data->'answerChosenBy'->>'id' IS NOT NULL
         AND iss.data->'answerChosenBy'->>'id' = mc.mentioned_user_id
         AND NULLIF(iss.data->>'answerChosenAt', '')::timestamptz >= mc.mentioned_at
       )
     ORDER BY mc.comment_id, mc.mentioned_user_id, mc.mentioned_at`,
    [excludedRepositoryIds, excludedUserIds, now],
  );

  const mentionIssueIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.issue_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const snapshotResult = mentionIssueIds.length
    ? await query<MentionIssueSnapshotRow>(
        `SELECT
           id,
           issue_project_status,
           issue_project_status_source,
           issue_project_status_locked,
           issue_todo_project_status,
           issue_todo_project_priority,
           issue_todo_project_weight,
           issue_todo_project_initiation_options,
           issue_todo_project_start_date
         FROM activity_items
         WHERE id = ANY($1::text[])`,
        [mentionIssueIds],
      )
    : { rows: [] as MentionIssueSnapshotRow[] };

  const mentionIssueSnapshotMap = new Map<string, MentionIssueSnapshotRow>();
  snapshotResult.rows.forEach((row) => {
    mentionIssueSnapshotMap.set(row.id, row);
  });

  let mentionActivityHistory: Awaited<
    ReturnType<typeof getActivityStatusHistory>
  >;
  let mentionProjectOverrides: Awaited<
    ReturnType<typeof getProjectFieldOverrides>
  >;
  if (mentionIssueIds.length) {
    [mentionActivityHistory, mentionProjectOverrides] = await Promise.all([
      getActivityStatusHistory(mentionIssueIds),
      getProjectFieldOverrides(mentionIssueIds),
    ]);
  } else {
    mentionActivityHistory = new Map();
    mentionProjectOverrides = new Map();
  }

  const items: MentionDatasetItem[] = [];

  const mentionedUserIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.mentioned_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [preferencesMap, personalHolidayMap] = await Promise.all([
    getUserPreferencesByIds(mentionedUserIds),
    listUserPersonalHolidaysByIds(mentionedUserIds),
  ]);

  const getPersonalHolidaySet = createPersonalHolidaySetLoader({
    organizationHolidayCodes,
    organizationHolidaySet,
    preferencesMap,
    personalHolidayMap,
  });

  for (const row of result.rows) {
    const personalHolidays = await getPersonalHolidaySet(row.mentioned_user_id);
    const waitingDays = differenceInDays(
      row.mentioned_at,
      now,
      personalHolidays,
    );
    if (waitingDays < UNANSWERED_MENTION_BUSINESS_DAYS) {
      continue;
    }

    type ContainerType = "issue" | "pull_request" | "discussion";
    const containerType: ContainerType = row.pr_id
      ? "pull_request"
      : row.issue_type === "discussion"
        ? "discussion"
        : "issue";
    const containerId =
      containerType === "pull_request"
        ? (row.pr_id as string)
        : (row.issue_id as string);
    const containerNumber =
      containerType === "pull_request" ? row.pr_number : row.issue_number;
    const containerTitle =
      containerType === "pull_request" ? row.pr_title : row.issue_title;
    const containerUrl =
      containerType === "pull_request" ? row.pr_url : row.issue_url;
    const repositoryId = row.repository_id;
    let issueProjectStatus: IssueProjectStatus | null = null;
    let issueProjectStatusSource: "todo_project" | "activity" | "none" = "none";
    let issueProjectStatusLocked = false;
    let issueTodoProjectStatus: IssueProjectStatus | null = null;
    let issueTodoProjectPriority: string | null = null;
    let issueTodoProjectWeight: string | null = null;
    let issueTodoProjectInitiationOptions: string | null = null;
    let issueTodoProjectStartDate: string | null = null;

    if (containerType === "issue" && row.issue_id) {
      const snapshot = mentionIssueSnapshotMap.get(row.issue_id);
      if (snapshot) {
        const source = snapshot.issue_project_status_source;
        issueProjectStatus =
          snapshot.issue_project_status === null
            ? null
            : (snapshot.issue_project_status as IssueProjectStatus);
        issueProjectStatusSource =
          source === "todo_project" || source === "activity" ? source : "none";
        issueProjectStatusLocked =
          snapshot.issue_project_status_locked ?? false;
        issueTodoProjectStatus =
          snapshot.issue_todo_project_status === null
            ? null
            : (snapshot.issue_todo_project_status as IssueProjectStatus);
        issueTodoProjectPriority = snapshot.issue_todo_project_priority ?? null;
        issueTodoProjectWeight = snapshot.issue_todo_project_weight ?? null;
        issueTodoProjectInitiationOptions =
          snapshot.issue_todo_project_initiation_options ?? null;
        issueTodoProjectStartDate =
          snapshot.issue_todo_project_start_date ?? null;
      }

      if (issueProjectStatus === null && issueTodoProjectStatus === null) {
        const issueRaw = parseIssueRaw(row.issue_data);
        const activityEvents = mentionActivityHistory.get(row.issue_id) ?? [];
        const statusInfo = resolveIssueStatusInfo(
          issueRaw,
          targetProject,
          activityEvents,
        );
        const projectSnapshot = resolveIssueProjectSnapshot(
          issueRaw,
          targetProject,
        );
        issueProjectStatus = statusInfo.displayStatus;
        issueProjectStatusSource = statusInfo.source;
        issueProjectStatusLocked = statusInfo.locked;
        issueTodoProjectStatus = statusInfo.todoStatus;
        issueTodoProjectPriority = projectSnapshot.priority;
        issueTodoProjectWeight = projectSnapshot.weight;
        issueTodoProjectInitiationOptions = projectSnapshot.initiationOptions;
        issueTodoProjectStartDate = projectSnapshot.startDate;
      }

      const overrideTarget = {
        issueProjectStatusLocked,
        issueTodoProjectPriority,
        issueTodoProjectWeight,
        issueTodoProjectInitiationOptions,
        issueTodoProjectStartDate,
      };
      applyProjectFieldOverridesToTarget(
        overrideTarget,
        mentionProjectOverrides.get(row.issue_id),
      );
      issueTodoProjectPriority =
        overrideTarget.issueTodoProjectPriority ?? null;
      issueTodoProjectWeight = overrideTarget.issueTodoProjectWeight ?? null;
      issueTodoProjectInitiationOptions =
        overrideTarget.issueTodoProjectInitiationOptions ?? null;
      issueTodoProjectStartDate =
        overrideTarget.issueTodoProjectStartDate ?? null;
    }

    items.push({
      commentId: row.comment_id,
      url: row.comment_url,
      mentionedAt: row.mentioned_at,
      waitingDays,
      commentAuthorId: row.comment_author_id,
      targetUserId: row.mentioned_user_id,
      container: {
        type: containerType,
        id: containerId,
        number: containerNumber,
        title: containerTitle,
        url: containerUrl,
        repositoryId,
        repositoryName: row.repository_name,
        repositoryNameWithOwner: row.repository_name_with_owner,
      },
      commentExcerpt: extractCommentExcerpt(row.comment_body),
      commentBody: row.comment_body ?? null,
      commentBodyHash: computeCommentBodyHash(row.comment_body),
      mentionedLogin: row.mentioned_login ?? null,
      issueProjectStatus,
      issueProjectStatusSource,
      issueProjectStatusLocked,
      issueTodoProjectStatus,
      issueTodoProjectPriority,
      issueTodoProjectWeight,
      issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate,
    });
  }

  return items;
}

export async function fetchUnansweredMentions(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
  targetProject: string | null,
  options?: { useClassifier?: boolean },
): Promise<Dataset<MentionRawItem>> {
  const candidates = await fetchUnansweredMentionCandidates(
    excludedRepositoryIds,
    excludedUserIds,
    now,
    organizationHolidayCodes,
    organizationHolidaySet,
    targetProject,
  );

  const classificationInputs = candidates
    .filter((item) => Boolean(item.targetUserId))
    .map((item) => ({
      commentId: item.commentId,
      mentionedUserId: item.targetUserId as string,
    }));

  const classifications = classificationInputs.length
    ? await fetchMentionClassifications(classificationInputs)
    : new Map<string, MentionClassificationRecord>();
  const useClassifier = options?.useClassifier ?? true;
  const filteredItems: MentionRawItem[] = [];
  const userIds = new Set<string>();

  for (const item of candidates) {
    const targetUserId = item.targetUserId;
    if (!targetUserId) {
      continue;
    }
    const key = buildMentionClassificationKey(item.commentId, targetUserId);
    const record = classifications.get(key);
    const manualDecision = resolveManualDecision(record);
    if (manualDecision.value === false) {
      continue;
    }

    if (useClassifier) {
      if (!record) {
        continue;
      }
      if (record.promptVersion !== UNANSWERED_MENTION_PROMPT_VERSION) {
        continue;
      }
      if (record.commentBodyHash !== item.commentBodyHash) {
        continue;
      }
      if (!manualDecision.value && !record.requiresResponse) {
        continue;
      }
    }

    filteredItems.push({
      commentId: item.commentId,
      url: item.url,
      mentionedAt: item.mentionedAt,
      waitingDays: item.waitingDays,
      commentAuthorId: item.commentAuthorId,
      targetUserId,
      container: item.container,
      commentExcerpt: item.commentExcerpt,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
      classification: record
        ? {
            requiresResponse: record.requiresResponse,
            manualRequiresResponse: manualDecision.value,
            manualRequiresResponseAt: manualDecision.appliedAt,
            manualDecisionIsStale: manualDecision.isStale,
            lastEvaluatedAt: record.lastEvaluatedAt,
          }
        : null,
    });
    addUserId(userIds, item.commentAuthorId);
    addUserId(userIds, targetUserId);
  }

  return { items: filteredItems, userIds };
}
