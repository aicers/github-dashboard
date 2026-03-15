import { getProjectFieldOverrides } from "@/lib/activity/project-field-store";
import { getActivityStatusHistory } from "@/lib/activity/status-store";
import { resolveWorkTimestamps } from "@/lib/activity/status-utils";
import {
  applyProjectFieldOverridesToTarget,
  resolveIssueProjectSnapshot,
  resolveIssueStatusInfo,
} from "@/lib/dashboard/attention/project-fields";
import {
  addUserId,
  BACKLOG_ISSUE_BUSINESS_DAYS,
  buildIssueLabels,
  type Dataset,
  differenceInDays,
  differenceInDaysOrNull,
  fetchLinkedIssuesForPullRequests,
  fetchLinkedPullRequestsForIssues,
  fetchReviewerMap,
  fetchUserIdsByLogins,
  type IssueRawItem,
  type IssueRow,
  type MergeDelayedPullRequestRow,
  normalizeTimeZone,
  OCTOAIDE_LOGINS,
  PR_FOLLOW_UP_BUSINESS_DAYS,
  type PullRequestRow,
  type RawPullRequestItem,
  type ReviewerLastActivityRow,
  type ReviewerRequestedAtRow,
  STALLED_IN_PROGRESS_BUSINESS_DAYS,
} from "@/lib/dashboard/attention/types";
import { differenceInBusinessDaysInTimeZone } from "@/lib/dashboard/business-days-timezone";
import { createPersonalHolidaySetLoader } from "@/lib/dashboard/personal-holidays";
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

function extractAssigneeIds(
  raw: {
    projectStatusHistory?: unknown;
    projectItems?: unknown;
    assignees?: { nodes?: unknown[] } | null;
  } | null,
) {
  if (!raw) {
    return [] as string[];
  }

  const assigneeNodes = Array.isArray(raw.assignees?.nodes)
    ? (raw.assignees?.nodes as unknown[])
    : [];

  const ids = new Set<string>();
  assigneeNodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (id) {
      ids.add(id);
    }
  });

  return Array.from(ids);
}

export async function fetchReviewUnassignedPullRequests(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  minimumDays: number,
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
): Promise<Dataset<RawPullRequestItem>> {
  const result = await query<PullRequestRow>(
    `SELECT
       pr.id,
       pr.number,
       pr.title,
       pr.repository_id,
       pr.author_id,
       pr.github_created_at,
       pr.github_updated_at,
       pr.data->>'url' AS url,
       repo.name AS repository_name,
       repo.name_with_owner AS repository_name_with_owner
    FROM pull_requests pr
    JOIN repositories repo ON repo.id = pr.repository_id
    WHERE pr.github_closed_at IS NULL
       AND pr.github_merged_at IS NULL
       AND COALESCE(pr.merged, FALSE) = FALSE
       AND (pr.state IS NULL OR pr.state = 'OPEN')
       AND pr.github_created_at <= $3::timestamptz - make_interval(days => $4)
       AND NOT (pr.repository_id = ANY($1::text[]))
       AND (pr.author_id IS NULL OR NOT (pr.author_id = ANY($2::text[])))
       AND NOT EXISTS (
         SELECT 1
         FROM review_requests rr
         WHERE rr.pull_request_id = pr.id
           AND (
             rr.reviewer_id IS NULL
             OR NOT (rr.reviewer_id = ANY($2::text[]))
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM reviews rv
         WHERE rv.pull_request_id = pr.id
           AND rv.author_id IS NOT NULL
           AND NOT (rv.author_id = ANY($2::text[]))
       )
     ORDER BY pr.github_created_at ASC`,
    [excludedRepositoryIds, excludedUserIds, now, minimumDays],
  );

  const repositoryIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.repository_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [maintainersByRepository, linkedIssuesMap] = await Promise.all([
    fetchRepositoryMaintainersByRepository(repositoryIds),
    fetchLinkedIssuesForPullRequests(result.rows.map((row) => row.id)),
  ]);

  const maintainerIds = Array.from(
    new Set(
      repositoryIds.flatMap(
        (repoId) => maintainersByRepository.get(repoId) ?? [],
      ),
    ),
  );

  const [preferencesMap, personalHolidayMap] = await Promise.all([
    getUserPreferencesByIds(maintainerIds),
    listUserPersonalHolidaysByIds(maintainerIds),
  ]);
  const getPersonalHolidaySet = createPersonalHolidaySetLoader({
    organizationHolidayCodes,
    organizationHolidaySet,
    preferencesMap,
    personalHolidayMap,
  });

  const userIds = new Set<string>();
  const items: RawPullRequestItem[] = [];

  for (const row of result.rows) {
    if (!row.repository_id || !row.github_created_at) {
      continue;
    }

    const maintainerIdsForRepo = (
      maintainersByRepository.get(row.repository_id) ?? []
    ).filter((id) => !excludedUserIds.includes(id));
    const people = maintainerIdsForRepo.length
      ? maintainerIdsForRepo
      : row.author_id
        ? [row.author_id]
        : [];

    if (people.length === 0) {
      continue;
    }

    let minWaiting = Number.POSITIVE_INFINITY;
    let qualifies = true;

    for (const personId of people) {
      const holidays = await getPersonalHolidaySet(personId);
      const tz =
        normalizeTimeZone(preferencesMap.get(personId)?.timezone) ??
        "Asia/Seoul";
      const waitingDays = differenceInBusinessDaysInTimeZone(
        row.github_created_at,
        now,
        holidays,
        tz,
      );
      minWaiting = Math.min(minWaiting, waitingDays);
      if (waitingDays < PR_FOLLOW_UP_BUSINESS_DAYS) {
        qualifies = false;
        break;
      }
    }

    if (!qualifies || !Number.isFinite(minWaiting)) {
      continue;
    }

    addUserId(userIds, row.author_id);
    for (const id of people) {
      addUserId(userIds, id);
    }

    items.push({
      id: row.id,
      number: row.number,
      title: row.title,
      url: row.url,
      repositoryId: row.repository_id,
      repositoryName: row.repository_name,
      repositoryNameWithOwner: row.repository_name_with_owner,
      authorId: row.author_id,
      reviewerIds: [],
      linkedIssues: linkedIssuesMap.get(row.id) ?? [],
      createdAt: row.github_created_at,
      updatedAt: row.github_updated_at,
      ageDays: differenceInDays(
        row.github_created_at,
        now,
        organizationHolidaySet,
      ),
      inactivityDays:
        differenceInDaysOrNull(
          row.github_updated_at,
          now,
          organizationHolidaySet,
        ) ?? undefined,
      waitingDays: minWaiting,
    });
  }

  return { items, userIds };
}

export async function fetchReviewStalledPullRequests(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  minimumDays: number,
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
): Promise<Dataset<RawPullRequestItem>> {
  const result = await query<PullRequestRow>(
    `SELECT
       pr.id,
       pr.number,
       pr.title,
       pr.repository_id,
       pr.author_id,
       pr.github_created_at,
       pr.github_updated_at,
       pr.data->>'url' AS url,
       repo.name AS repository_name,
       repo.name_with_owner AS repository_name_with_owner
    FROM pull_requests pr
    JOIN repositories repo ON repo.id = pr.repository_id
    WHERE pr.github_closed_at IS NULL
       AND pr.github_created_at <= $3::timestamptz - make_interval(days => $4)
       AND NOT (pr.repository_id = ANY($1::text[]))
       AND (pr.author_id IS NULL OR NOT (pr.author_id = ANY($2::text[])))
       AND EXISTS (
         SELECT 1
         FROM review_requests rr
         WHERE rr.pull_request_id = pr.id
           AND rr.reviewer_id IS NOT NULL
           AND rr.removed_at IS NULL
           AND NOT (rr.reviewer_id = ANY($2::text[]))
       )
     ORDER BY pr.github_updated_at ASC NULLS LAST`,
    [excludedRepositoryIds, excludedUserIds, now, minimumDays],
  );

  const prIds = result.rows.map((row) => row.id);
  const [reviewerMap, linkedIssuesMap, octoaideUserIds] = await Promise.all([
    fetchReviewerMap(prIds, excludedUserIds),
    fetchLinkedIssuesForPullRequests(prIds),
    fetchUserIdsByLogins(OCTOAIDE_LOGINS),
  ]);

  const reviewerIds = Array.from(
    new Set(Array.from(reviewerMap.values()).flatMap((set) => Array.from(set))),
  );
  const [preferencesMap, personalHolidayMap] = await Promise.all([
    getUserPreferencesByIds(reviewerIds),
    listUserPersonalHolidaysByIds(reviewerIds),
  ]);
  const getPersonalHolidaySet = createPersonalHolidaySetLoader({
    organizationHolidayCodes,
    organizationHolidaySet,
    preferencesMap,
    personalHolidayMap,
  });

  const requestedAtResult = prIds.length
    ? await query<ReviewerRequestedAtRow>(
        `SELECT pull_request_id,
                reviewer_id,
                MAX(requested_at) AS requested_at
           FROM review_requests
          WHERE pull_request_id = ANY($1::text[])
            AND reviewer_id IS NOT NULL
            AND removed_at IS NULL
            AND NOT (reviewer_id = ANY($2::text[]))
          GROUP BY pull_request_id, reviewer_id`,
        [prIds, excludedUserIds],
      )
    : { rows: [] as ReviewerRequestedAtRow[] };

  const requestedAtMap = new Map<string, string>();
  requestedAtResult.rows.forEach((row) => {
    if (!row.pull_request_id || !row.reviewer_id || !row.requested_at) {
      return;
    }
    requestedAtMap.set(
      `${row.pull_request_id}:${row.reviewer_id}`,
      row.requested_at,
    );
  });

  const excludedForActivity = Array.from(
    new Set([...excludedUserIds, ...octoaideUserIds]),
  );
  const activityResult = prIds.length
    ? await query<ReviewerLastActivityRow>(
        `SELECT pull_request_id,
                author_id,
                MAX(activity_at) AS last_activity_at
           FROM (
             SELECT pull_request_id,
                    author_id,
                    github_created_at AS activity_at
               FROM comments
              WHERE pull_request_id = ANY($1::text[])
                AND author_id IS NOT NULL
                AND NOT (author_id = ANY($2::text[]))
             UNION ALL
             SELECT pull_request_id,
                    author_id,
                    github_submitted_at AS activity_at
               FROM reviews
              WHERE pull_request_id = ANY($1::text[])
                AND github_submitted_at IS NOT NULL
                AND author_id IS NOT NULL
                AND NOT (author_id = ANY($2::text[]))
           ) activities
          GROUP BY pull_request_id, author_id`,
        [prIds, excludedForActivity],
      )
    : { rows: [] as ReviewerLastActivityRow[] };

  const activityMap = new Map<string, string>();
  activityResult.rows.forEach((row) => {
    if (!row.pull_request_id || !row.author_id || !row.last_activity_at) {
      return;
    }
    activityMap.set(
      `${row.pull_request_id}:${row.author_id}`,
      row.last_activity_at,
    );
  });

  const userIds = new Set<string>();
  const items: RawPullRequestItem[] = [];

  for (const row of result.rows) {
    if (!row.github_created_at) {
      continue;
    }
    const reviewers = reviewerMap.get(row.id) ?? new Set<string>();
    const reviewerIdList = Array.from(reviewers);
    if (reviewerIdList.length === 0) {
      continue;
    }

    let minWaiting = Number.POSITIVE_INFINITY;
    let lastActivity = null as string | null;
    let qualifies = true;

    for (const reviewerId of reviewerIdList) {
      const key = `${row.id}:${reviewerId}`;
      const requestedAt = requestedAtMap.get(key) ?? null;
      const latestActivity = activityMap.get(key) ?? null;

      let baseline = requestedAt ?? row.github_created_at;
      if (latestActivity && (!requestedAt || latestActivity >= requestedAt)) {
        baseline = latestActivity;
      }

      const holidays = await getPersonalHolidaySet(reviewerId);
      const tz =
        normalizeTimeZone(preferencesMap.get(reviewerId)?.timezone) ??
        "Asia/Seoul";
      const waitingDays = differenceInBusinessDaysInTimeZone(
        baseline,
        now,
        holidays,
        tz,
      );
      minWaiting = Math.min(minWaiting, waitingDays);
      if (waitingDays < PR_FOLLOW_UP_BUSINESS_DAYS) {
        qualifies = false;
        break;
      }

      if (!lastActivity || baseline > lastActivity) {
        lastActivity = baseline;
      }
    }

    if (!qualifies || !Number.isFinite(minWaiting)) {
      continue;
    }

    addUserId(userIds, row.author_id);
    reviewerIdList.forEach((id) => {
      addUserId(userIds, id);
    });

    items.push({
      id: row.id,
      number: row.number,
      title: row.title,
      url: row.url,
      repositoryId: row.repository_id,
      repositoryName: row.repository_name,
      repositoryNameWithOwner: row.repository_name_with_owner,
      authorId: row.author_id,
      reviewerIds: reviewerIdList,
      linkedIssues: linkedIssuesMap.get(row.id) ?? [],
      createdAt: row.github_created_at,
      updatedAt: lastActivity ?? row.github_updated_at,
      ageDays: differenceInDays(
        row.github_created_at,
        now,
        organizationHolidaySet,
      ),
      inactivityDays:
        differenceInDaysOrNull(
          row.github_updated_at,
          now,
          organizationHolidaySet,
        ) ?? undefined,
      waitingDays: minWaiting,
    });
  }

  return { items, userIds };
}

function parseRawRecord(data: unknown): Record<string, unknown> | null {
  if (!data) {
    return null;
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  if (typeof data === "object") {
    return data as Record<string, unknown>;
  }

  return null;
}

function extractPullRequestAssigneeIds(raw: unknown) {
  const record = parseRawRecord(raw);
  if (!record) {
    return [] as string[];
  }

  const assignees = record.assignees;
  if (!assignees || typeof assignees !== "object") {
    return [] as string[];
  }

  const nodes = Array.isArray((assignees as { nodes?: unknown }).nodes)
    ? ((assignees as { nodes?: unknown[] }).nodes ?? [])
    : [];

  const ids = new Set<string>();
  nodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }
    const id = (node as { id?: unknown }).id;
    if (typeof id === "string" && id.trim().length) {
      ids.add(id);
    }
  });

  return Array.from(ids);
}

export async function fetchMergeDelayedPullRequests(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  minimumDays: number,
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
): Promise<Dataset<RawPullRequestItem>> {
  const result = await query<MergeDelayedPullRequestRow>(
    `SELECT
       pr.id,
       pr.number,
       pr.title,
       pr.repository_id,
       pr.author_id,
       pr.github_created_at,
       pr.github_updated_at,
       pr.data AS raw_data,
       pr.data->>'url' AS url,
       repo.name AS repository_name,
       repo.name_with_owner AS repository_name_with_owner,
       approval.approved_at
    FROM pull_requests pr
    JOIN repositories repo ON repo.id = pr.repository_id
    JOIN LATERAL (
       SELECT MAX(github_submitted_at) AS approved_at
       FROM reviews r
       WHERE r.pull_request_id = pr.id
         AND r.github_submitted_at IS NOT NULL
         AND r.state = 'APPROVED'
    ) approval ON TRUE
    WHERE pr.github_closed_at IS NULL
      AND approval.approved_at IS NOT NULL
      AND pr.data->>'reviewDecision' = 'APPROVED'
      AND approval.approved_at <= $3::timestamptz - make_interval(days => $4)
      AND NOT (pr.repository_id = ANY($1::text[]))
      AND (pr.author_id IS NULL OR NOT (pr.author_id = ANY($2::text[])))
    ORDER BY approval.approved_at ASC`,
    [excludedRepositoryIds, excludedUserIds, now, minimumDays],
  );

  const prIds = result.rows.map((row) => row.id);
  const repositoryIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.repository_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [reviewerMap, linkedIssuesMap, maintainersByRepository] =
    await Promise.all([
      fetchReviewerMap(prIds, excludedUserIds),
      fetchLinkedIssuesForPullRequests(prIds),
      fetchRepositoryMaintainersByRepository(repositoryIds),
    ]);

  const maintainerIds = Array.from(
    new Set(
      repositoryIds.flatMap(
        (repoId) => maintainersByRepository.get(repoId) ?? [],
      ),
    ),
  );
  const [preferencesMap, personalHolidayMap] = await Promise.all([
    getUserPreferencesByIds(maintainerIds),
    listUserPersonalHolidaysByIds(maintainerIds),
  ]);
  const getPersonalHolidaySet = createPersonalHolidaySetLoader({
    organizationHolidayCodes,
    organizationHolidaySet,
    preferencesMap,
    personalHolidayMap,
  });

  const userIds = new Set<string>();
  const items: RawPullRequestItem[] = [];

  for (const row of result.rows) {
    if (!row.repository_id || !row.approved_at || !row.github_created_at) {
      continue;
    }

    const maintainerIdsForRepo = (
      maintainersByRepository.get(row.repository_id) ?? []
    ).filter((id) => !excludedUserIds.includes(id));
    const people = maintainerIdsForRepo.length
      ? maintainerIdsForRepo
      : row.author_id
        ? [row.author_id]
        : [];
    if (people.length === 0) {
      continue;
    }

    let minWaiting = Number.POSITIVE_INFINITY;
    let qualifies = true;
    for (const personId of people) {
      const holidays = await getPersonalHolidaySet(personId);
      const tz =
        normalizeTimeZone(preferencesMap.get(personId)?.timezone) ??
        "Asia/Seoul";
      const waitingDays = differenceInBusinessDaysInTimeZone(
        row.approved_at,
        now,
        holidays,
        tz,
      );
      minWaiting = Math.min(minWaiting, waitingDays);
      if (waitingDays < PR_FOLLOW_UP_BUSINESS_DAYS) {
        qualifies = false;
        break;
      }
    }

    if (!qualifies || !Number.isFinite(minWaiting)) {
      continue;
    }

    const reviewers = reviewerMap.get(row.id) ?? new Set<string>();
    const reviewerIds = Array.from(reviewers);
    const assigneeIds = extractPullRequestAssigneeIds(row.raw_data).filter(
      (id) => !excludedUserIds.includes(id),
    );
    addUserId(userIds, row.author_id);
    reviewerIds.forEach((id) => {
      addUserId(userIds, id);
    });
    people.forEach((id) => {
      addUserId(userIds, id);
    });
    assigneeIds.forEach((id) => {
      addUserId(userIds, id);
    });

    items.push({
      id: row.id,
      number: row.number,
      title: row.title,
      url: row.url,
      repositoryId: row.repository_id,
      repositoryName: row.repository_name,
      repositoryNameWithOwner: row.repository_name_with_owner,
      authorId: row.author_id,
      reviewerIds,
      assigneeIds,
      linkedIssues: linkedIssuesMap.get(row.id) ?? [],
      createdAt: row.github_created_at,
      updatedAt: row.approved_at,
      ageDays: differenceInDays(
        row.github_created_at,
        now,
        organizationHolidaySet,
      ),
      inactivityDays:
        differenceInDaysOrNull(
          row.github_updated_at,
          now,
          organizationHolidaySet,
        ) ?? undefined,
      waitingDays: minWaiting,
    });
  }

  return { items, userIds };
}

export async function fetchIssueInsights(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  targetProject: string | null,
  now: Date,
  holidays: ReadonlySet<string>,
): Promise<{
  backlog: Dataset<IssueRawItem>;
  stalled: Dataset<IssueRawItem>;
  repositoryMaintainersByRepository: Map<string, string[]>;
}> {
  const result = await query<IssueRow>(
    `SELECT
       items.id,
       items.number,
       items.title,
       items.repository_id,
       items.author_id,
       items.created_at,
       items.updated_at,
       items.closed_at,
       items.state,
       items.url,
       items.raw_data,
       items.repository_name,
       items.repository_name_with_owner,
       items.label_keys,
       items.label_names,
       items.issue_type_id,
       items.issue_type_name,
       items.milestone_id,
       items.milestone_title,
       items.milestone_state,
       items.milestone_due_on,
       items.milestone_url
     FROM activity_items AS items
     WHERE items.item_type = 'issue'
       AND items.status = 'open'
       AND items.created_at <= NOW() - INTERVAL '26 days'
       AND LOWER(COALESCE(items.raw_data->>'__typename', 'issue')) NOT IN ('discussion', 'teamdiscussion')
       AND (items.repository_id IS NULL OR NOT (items.repository_id = ANY($1::text[])))
       AND (items.author_id IS NULL OR NOT (items.author_id = ANY($2::text[])))
     ORDER BY items.created_at ASC`,
    [excludedRepositoryIds, excludedUserIds],
  );

  const issueIds = result.rows.map((row) => row.id);
  const repositoryIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.repository_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const maintainersResult = repositoryIds.length
    ? await query<{ repository_id: string; user_id: string }>(
        `SELECT repository_id, user_id
           FROM repository_maintainers
          WHERE repository_id = ANY($1::text[])`,
        [repositoryIds],
      )
    : { rows: [] as { repository_id: string; user_id: string }[] };
  const repositoryMaintainerMap = new Map<string, string[]>();
  maintainersResult.rows.forEach((row) => {
    const list = repositoryMaintainerMap.get(row.repository_id) ?? [];
    list.push(row.user_id);
    repositoryMaintainerMap.set(row.repository_id, list);
  });
  const [activityHistory, projectOverrides] = await Promise.all([
    getActivityStatusHistory(issueIds),
    getProjectFieldOverrides(issueIds),
  ]);

  const backlogItems: IssueRawItem[] = [];
  const backlogUserIds = new Set<string>();
  const stalledItems: IssueRawItem[] = [];
  const stalledUserIds = new Set<string>();

  for (const row of result.rows) {
    const raw = parseIssueRaw(row.raw_data);
    const activityEvents = activityHistory.get(row.id) ?? [];
    const statusInfo = resolveIssueStatusInfo(
      raw,
      targetProject,
      activityEvents,
    );
    const work = resolveWorkTimestamps(statusInfo);
    if (!row.repository_id || !row.created_at) {
      continue;
    }
    const assigneeIds = extractAssigneeIds(raw).filter(
      (id) => !excludedUserIds.includes(id),
    );
    const projectSnapshot = resolveIssueProjectSnapshot(raw, targetProject);
    const startedAt = work.startedAt;
    const inProgressAgeRaw = startedAt
      ? differenceInDaysOrNull(startedAt, now, holidays)
      : null;
    const inProgressAgeDays =
      typeof inProgressAgeRaw === "number" ? inProgressAgeRaw : null;
    const ageDays = differenceInDays(row.created_at, now, holidays);
    const inactivityDays = differenceInDaysOrNull(
      row.updated_at ?? row.created_at,
      now,
      holidays,
    );
    const labels = buildIssueLabels({
      labelKeys: row.label_keys,
      labelNames: row.label_names,
      repositoryId: row.repository_id,
      repositoryNameWithOwner: row.repository_name_with_owner,
    });
    const repositoryMaintainerIds =
      repositoryMaintainerMap.get(row.repository_id ?? "") ?? [];
    const baseItem: IssueRawItem = {
      id: row.id,
      number: row.number,
      title: row.title,
      url: row.url,
      repositoryId: row.repository_id,
      repositoryName: row.repository_name,
      repositoryNameWithOwner: row.repository_name_with_owner,
      repositoryMaintainerIds,
      authorId: row.author_id,
      assigneeIds,
      linkedPullRequests: [],
      labels,
      issueTypeId: row.issue_type_id,
      issueTypeName: row.issue_type_name,
      milestoneId: row.milestone_id,
      milestoneTitle: row.milestone_title,
      milestoneState: row.milestone_state,
      milestoneDueOn: row.milestone_due_on,
      milestoneUrl: row.milestone_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ageDays,
      inactivityDays,
      startedAt,
      inProgressAgeDays,
      issueProjectStatus: statusInfo.displayStatus,
      issueProjectStatusSource: statusInfo.source,
      issueProjectStatusLocked: statusInfo.locked,
      issueTodoProjectStatus: statusInfo.todoStatus,
      issueTodoProjectPriority: projectSnapshot.priority,
      issueTodoProjectWeight: projectSnapshot.weight,
      issueTodoProjectInitiationOptions: projectSnapshot.initiationOptions,
      issueTodoProjectStartDate: projectSnapshot.startDate,
    };
    applyProjectFieldOverridesToTarget(baseItem, projectOverrides.get(row.id));

    const isClosed =
      (row.state && row.state.toLowerCase() === "closed") || row.closed_at;

    const displayStatus = statusInfo.displayStatus;
    const isBacklogStatus =
      displayStatus === "no_status" || displayStatus === "todo";
    if (isBacklogStatus) {
      if (ageDays >= BACKLOG_ISSUE_BUSINESS_DAYS) {
        backlogItems.push(baseItem);
        for (const id of repositoryMaintainerIds) {
          addUserId(backlogUserIds, id);
        }
        addUserId(backlogUserIds, row.author_id);
        assigneeIds.forEach((id) => {
          addUserId(backlogUserIds, id);
        });
      }
      continue;
    }

    if (!isClosed) {
      const qualifiesInProgress =
        displayStatus === "in_progress" &&
        typeof inProgressAgeDays === "number" &&
        inProgressAgeDays >= STALLED_IN_PROGRESS_BUSINESS_DAYS;
      const qualifiesPending =
        displayStatus === "pending" &&
        startedAt !== null &&
        typeof inProgressAgeDays === "number" &&
        inProgressAgeDays >= STALLED_IN_PROGRESS_BUSINESS_DAYS;

      if (qualifiesInProgress || qualifiesPending) {
        stalledItems.push(baseItem);
        for (const id of repositoryMaintainerIds) {
          addUserId(stalledUserIds, id);
        }
        addUserId(stalledUserIds, row.author_id);
        assigneeIds.forEach((id) => {
          addUserId(stalledUserIds, id);
        });
      }
    }
  }

  const issueIdSet = new Set<string>([
    ...backlogItems.map((item) => item.id),
    ...stalledItems.map((item) => item.id),
  ]);
  const linkedPullRequestsMap = await fetchLinkedPullRequestsForIssues(
    Array.from(issueIdSet),
  );
  backlogItems.forEach((item) => {
    item.linkedPullRequests = linkedPullRequestsMap.get(item.id) ?? [];
  });
  stalledItems.forEach((item) => {
    item.linkedPullRequests = linkedPullRequestsMap.get(item.id) ?? [];
  });

  return {
    backlog: { items: backlogItems, userIds: backlogUserIds },
    stalled: { items: stalledItems, userIds: stalledUserIds },
    repositoryMaintainersByRepository: repositoryMaintainerMap,
  };
}

export async function fetchOrganizationMaintainerIds(): Promise<string[]> {
  const result = await query<{ user_id: string | null }>(
    `SELECT DISTINCT user_id
       FROM repository_maintainers
      WHERE user_id IS NOT NULL`,
  );

  return result.rows
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
}

export async function fetchRepositoryMaintainersByRepository(
  repositoryIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (!repositoryIds.length) {
    return new Map();
  }

  const result = await query<{ repository_id: string; user_id: string }>(
    `SELECT repository_id, user_id
       FROM repository_maintainers
      WHERE repository_id = ANY($1::text[])`,
    [repositoryIds],
  );

  const map = new Map<string, string[]>();
  result.rows.forEach((row) => {
    const list = map.get(row.repository_id) ?? [];
    list.push(row.user_id);
    map.set(row.repository_id, list);
  });
  return map;
}
