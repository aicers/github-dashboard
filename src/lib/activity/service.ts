import {
  getCachedActivityFilterOptions,
  getLinkedIssuesMap,
  getLinkedPullRequestsMap,
} from "@/lib/activity/cache";
import {
  getProjectFieldOverrides,
  type ProjectFieldOverrides,
} from "@/lib/activity/project-field-store";
import { ensureIssueStatusAutomation } from "@/lib/activity/status-automation";
import {
  type ActivityStatusEvent,
  getActivityStatusHistory,
} from "@/lib/activity/status-store";
import type {
  ActivityAttentionFilter,
  ActivityAttentionFlags,
  ActivityFilterOptions,
  ActivityIssueBaseStatusFilter,
  ActivityItem,
  ActivityItemComment,
  ActivityItemDetail,
  ActivityLabel,
  ActivityLinkedIssue,
  ActivityLinkedPullRequest,
  ActivityListParams,
  ActivityListResult,
  ActivityPullRequestStatusFilter,
  ActivityStatusFilter,
  ActivityThresholds,
  ActivityUser,
  IssueProjectStatus,
} from "@/lib/activity/types";
import {
  getAttentionInsights,
  type MentionAttentionItem,
  type ReviewRequestAttentionItem,
} from "@/lib/dashboard/attention";
import {
  differenceInBusinessDays,
  differenceInBusinessDaysOrNull,
  HOLIDAY_SET,
} from "@/lib/dashboard/business-days";
import { normalizeDateTimeDisplayFormat } from "@/lib/date-time-format";
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

const ISSUE_PROJECT_STATUS_VALUES: IssueProjectStatus[] = [
  "no_status",
  "todo",
  "in_progress",
  "done",
  "pending",
  "canceled",
];

const ISSUE_PROJECT_STATUS_SET = new Set(ISSUE_PROJECT_STATUS_VALUES);

const ISSUE_PROJECT_STATUS_LOCKED = new Set<IssueProjectStatus>([
  "in_progress",
  "done",
  "pending",
]);

function normalizePriorityText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("p0")) {
    return "P0";
  }
  if (lowered.startsWith("p1")) {
    return "P1";
  }
  if (lowered.startsWith("p2")) {
    return "P2";
  }
  return trimmed;
}

function normalizeWeightText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("heavy")) {
    return "Heavy";
  }
  if (lowered.startsWith("medium")) {
    return "Medium";
  }
  if (lowered.startsWith("light")) {
    return "Light";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function normalizePrioritySql(valueExpr: string) {
  return `(CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN BTRIM(${valueExpr}) = '' THEN NULL
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'p0%' THEN 'P0'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'p1%' THEN 'P1'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'p2%' THEN 'P2'
    ELSE BTRIM(${valueExpr})
  END)`;
}

function normalizeWeightSql(valueExpr: string) {
  return `(CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN BTRIM(${valueExpr}) = '' THEN NULL
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'heavy%' THEN 'Heavy'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'medium%' THEN 'Medium'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'light%' THEN 'Light'
    ELSE INITCAP(BTRIM(${valueExpr}))
  END)`;
}

const PR_STATUS_VALUES: ActivityPullRequestStatusFilter[] = [
  "pr_open",
  "pr_merged",
  "pr_closed",
];

const PR_STATUS_MAP: Record<
  ActivityPullRequestStatusFilter,
  "open" | "closed" | "merged"
> = {
  pr_open: "open",
  pr_merged: "merged",
  pr_closed: "closed",
};

const ISSUE_BASE_STATUS_VALUES: ActivityIssueBaseStatusFilter[] = [
  "issue_open",
  "issue_closed",
];

const ISSUE_BASE_STATUS_MAP: Record<
  ActivityIssueBaseStatusFilter,
  "open" | "closed"
> = {
  issue_open: "open",
  issue_closed: "closed",
};

type ActivityRow = {
  item_type: "issue" | "pull_request" | "discussion";
  id: string;
  number: number | null;
  title: string | null;
  state: string | null;
  status: "open" | "closed" | "merged";
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
  issue_type_id: string | null;
  issue_type_name: string | null;
  milestone_id: string | null;
  milestone_title: string | null;
  milestone_state: string | null;
  milestone_due_on: string | null;
  milestone_url: string | null;
  tracked_issues_count: number | null;
  tracked_in_issues_count: number | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  is_merged: boolean | null;
  raw_data: unknown;
  project_history: unknown;
  issue_project_status: string | null;
  issue_project_status_at: string | null;
  issue_project_status_locked: boolean | null;
  issue_display_status: string | null;
  issue_priority_value: string | null;
  issue_weight_value: string | null;
  activity_status: string | null;
  activity_status_at: string | null;
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
  reviewRequestDetails: Map<string, ReviewRequestAttentionItem[]>;
  mentionDetails: Map<string, MentionAttentionItem[]>;
};

type AttentionFilterSelection = {
  includeIds: string[];
  includeNone: boolean;
};

type IssueRaw = {
  projectStatusHistory?: unknown;
  projectItems?: { nodes?: unknown } | null;
};

type ProjectStatusEntry = {
  status: string;
  occurredAt: string;
};

type ProjectFieldAggregate = {
  value: string | null;
  updatedAt: string | null;
  dateValue: string | null;
};

type ProjectFieldValueInfo = {
  value: string | null;
  updatedAt: string | null;
  dateValue: string | null;
};

type TodoProjectFieldValues = {
  priority: string | null;
  priorityUpdatedAt: string | null;
  weight: string | null;
  weightUpdatedAt: string | null;
  initiationOptions: string | null;
  initiationOptionsUpdatedAt: string | null;
  startDate: string | null;
  startDateUpdatedAt: string | null;
};

type CommentRow = {
  id: string;
  author_id: string | null;
  review_id: string | null;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  data: unknown;
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

type UserReferenceLike = {
  id: string;
  login: string | null;
  name: string | null;
} | null;

function mapReferencedUser(
  reference: UserReferenceLike,
  users: Map<string, ActivityUser>,
): ActivityUser | null {
  if (!reference?.id) {
    return null;
  }

  const profile = users.get(reference.id);
  if (profile) {
    return {
      ...profile,
      login: profile.login ?? reference.login,
      name: profile.name ?? reference.name,
    };
  }

  return {
    id: reference.id,
    login: reference.login ?? null,
    name: reference.name ?? null,
    avatarUrl: null,
  };
}

function dedupeReviewRequestDetails(details: ReviewRequestAttentionItem[]) {
  const byReviewer = new Map<string, ReviewRequestAttentionItem>();
  const fallback = new Map<string, ReviewRequestAttentionItem>();

  details.forEach((detail) => {
    const reviewerId = detail.reviewer?.id?.trim();
    const key = reviewerId && reviewerId.length > 0 ? reviewerId : detail.id;
    const targetMap = reviewerId ? byReviewer : fallback;
    const existing = targetMap.get(key);
    if (!existing || detail.waitingDays > existing.waitingDays) {
      targetMap.set(key, detail);
    }
  });

  return [
    ...byReviewer.values(),
    ...fallback.values().filter((detail) => !byReviewer.has(detail.id)),
  ];
}

function dedupeMentionDetails(details: MentionAttentionItem[]) {
  const byTarget = new Map<string, MentionAttentionItem>();
  const fallback = new Map<string, MentionAttentionItem>();

  details.forEach((detail) => {
    const targetId = detail.target?.id?.trim();
    const key = targetId && targetId.length > 0 ? targetId : detail.commentId;
    const targetMap = targetId ? byTarget : fallback;
    const existing = targetMap.get(key);
    if (!existing || detail.waitingDays > existing.waitingDays) {
      targetMap.set(key, detail);
    }
  });

  return [
    ...byTarget.values(),
    ...fallback.values().filter((detail) => {
      const fallbackKey = detail.commentId;
      if (!fallbackKey) {
        return true;
      }
      return !byTarget.has(fallbackKey);
    }),
  ];
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

function normalizeText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
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

function normalizeProjectStatus(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function mapIssueProjectStatus(
  value: string | null | undefined,
): IssueProjectStatus {
  const normalized = normalizeProjectStatus(value);

  if (!normalized || normalized === "no" || normalized === "no_status") {
    return "no_status";
  }

  if (normalized === "todo" || normalized === "to_do") {
    return "todo";
  }

  if (
    normalized.includes("in_progress") ||
    normalized === "doing" ||
    normalized === "in-progress"
  ) {
    return "in_progress";
  }

  if (
    normalized === "done" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "finished" ||
    normalized === "closed"
  ) {
    return "done";
  }

  if (normalized.startsWith("pending") || normalized === "waiting") {
    return "pending";
  }

  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled";
  }

  return "no_status";
}

type IssueStatusInfo = {
  todoStatus: IssueProjectStatus | null;
  todoStatusAt: string | null;
  activityStatus: IssueProjectStatus | null;
  activityStatusAt: string | null;
  displayStatus: IssueProjectStatus;
  source: "todo_project" | "activity" | "none";
  locked: boolean;
  timelineSource: "todo_project" | "activity" | "none";
  projectEntries: ProjectStatusEntry[];
  activityEvents: ActivityStatusEvent[];
};

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

function resolveIssueStatusInfo(
  raw: IssueRaw | null,
  targetProject: string | null,
  activityEvents: ActivityStatusEvent[],
): IssueStatusInfo {
  const projectEntries = extractProjectStatusEntries(raw, targetProject);
  const latestProjectEntry =
    projectEntries.length > 0
      ? projectEntries[projectEntries.length - 1]
      : null;
  const todoStatus = latestProjectEntry
    ? mapIssueProjectStatus(latestProjectEntry.status)
    : null;
  const todoStatusAt = latestProjectEntry
    ? latestProjectEntry.occurredAt
    : null;

  const latestActivityEntry =
    activityEvents.length > 0
      ? activityEvents[activityEvents.length - 1]
      : null;
  const activityStatus = latestActivityEntry?.status ?? null;
  const activityStatusAt = latestActivityEntry?.occurredAt ?? null;

  const locked =
    todoStatus != null && ISSUE_PROJECT_STATUS_LOCKED.has(todoStatus);

  const parseTimestamp = (value: string | null | undefined) => {
    if (!value) {
      return null;
    }
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  };

  const todoTimestamp = parseTimestamp(todoStatusAt);
  const activityTimestamp = parseTimestamp(activityStatusAt);

  let displayStatus: IssueProjectStatus = "no_status";
  let source: IssueStatusInfo["source"] = "none";

  if (locked && todoStatus) {
    displayStatus = todoStatus;
    source = "todo_project";
  } else {
    const hasTodoStatus = todoStatus !== null;
    const hasActivityStatus = activityStatus !== null;

    if (hasTodoStatus && hasActivityStatus) {
      if (
        activityTimestamp !== null &&
        (todoTimestamp === null || activityTimestamp >= todoTimestamp)
      ) {
        displayStatus = activityStatus ?? "no_status";
        source = "activity";
      } else {
        displayStatus = todoStatus ?? "no_status";
        source = "todo_project";
      }
    } else if (hasActivityStatus) {
      displayStatus = activityStatus ?? "no_status";
      source = "activity";
    } else if (hasTodoStatus) {
      displayStatus = todoStatus ?? "no_status";
      source = "todo_project";
    }
  }

  let timelineSource: IssueStatusInfo["timelineSource"] = "none";
  if (source === "activity" && activityEvents.length > 0) {
    timelineSource = "activity";
  } else if (projectEntries.length > 0) {
    timelineSource = "todo_project";
  }
  if (timelineSource === "none" && activityEvents.length > 0) {
    timelineSource = "activity";
  }

  return {
    todoStatus,
    todoStatusAt,
    activityStatus,
    activityStatusAt,
    displayStatus,
    source,
    locked,
    timelineSource,
    projectEntries,
    activityEvents,
  };
}

function resolveWorkTimestamps(info: IssueStatusInfo | null) {
  if (!info) {
    return { startedAt: null, completedAt: null };
  }

  if (info.timelineSource === "activity") {
    let startedAt: string | null = null;
    let completedAt: string | null = null;
    info.activityEvents.forEach((event) => {
      switch (event.status) {
        case "in_progress":
          startedAt = event.occurredAt;
          completedAt = null;
          break;
        case "done":
        case "canceled":
          if (startedAt && !completedAt) {
            completedAt = event.occurredAt;
          }
          break;
        case "todo":
        case "no_status":
          startedAt = null;
          completedAt = null;
          break;
        default:
          break;
      }
    });
    return { startedAt, completedAt };
  }

  if (info.timelineSource === "todo_project") {
    let startedAt: string | null = null;
    let completedAt: string | null = null;
    info.projectEntries.forEach((entry) => {
      const mapped = mapIssueProjectStatus(entry.status);
      if (mapped === "in_progress") {
        startedAt = entry.occurredAt;
        completedAt = null;
        return;
      }
      if (mapped === "done" || mapped === "canceled") {
        if (startedAt && !completedAt) {
          completedAt = entry.occurredAt;
        }
        return;
      }
      if (mapped === "todo" || mapped === "no_status") {
        startedAt = null;
        completedAt = null;
      }
    });
    return { startedAt, completedAt };
  }

  return { startedAt: null, completedAt: null };
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

function createProjectFieldAggregate(): ProjectFieldAggregate {
  return { value: null, updatedAt: null, dateValue: null };
}

function compareTimestamps(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (leftTime === rightTime) {
      return 0;
    }
    return leftTime > rightTime ? 1 : -1;
  }

  return left.localeCompare(right);
}

function pickFirstTimestamp(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function extractProjectFieldValueInfo(
  value: unknown,
  fallbackTimestamps: string[],
): ProjectFieldValueInfo {
  if (!value || typeof value !== "object") {
    return {
      value: null,
      updatedAt: pickFirstTimestamp(fallbackTimestamps),
      dateValue: null,
    };
  }

  const record = value as Record<string, unknown>;

  let resolvedValue: string | null = null;
  if (typeof record.name === "string" && record.name.trim().length) {
    resolvedValue = record.name.trim();
  } else if (typeof record.title === "string" && record.title.trim().length) {
    resolvedValue = record.title.trim();
  } else if (typeof record.text === "string" && record.text.trim().length) {
    resolvedValue = record.text.trim();
  } else if (
    typeof record.number === "number" &&
    Number.isFinite(record.number)
  ) {
    resolvedValue = String(record.number);
  }

  let dateValue: string | null = null;
  if (typeof record.date === "string" && record.date.trim().length) {
    dateValue = record.date.trim();
    if (!resolvedValue) {
      resolvedValue = dateValue;
    }
  }

  let updatedAt: string | null = null;
  if (typeof record.updatedAt === "string" && record.updatedAt.trim().length) {
    updatedAt = record.updatedAt.trim();
  } else {
    updatedAt = pickFirstTimestamp(fallbackTimestamps);
  }

  return {
    value: resolvedValue,
    updatedAt,
    dateValue,
  };
}

function applyProjectFieldCandidate(
  aggregate: ProjectFieldAggregate,
  candidate: ProjectFieldValueInfo,
) {
  const candidateValue = candidate.value ?? candidate.dateValue ?? null;
  if (!candidateValue) {
    return;
  }

  if (!aggregate.value && !aggregate.dateValue) {
    aggregate.value = candidateValue;
    aggregate.dateValue = candidate.dateValue ?? null;
    aggregate.updatedAt = candidate.updatedAt ?? aggregate.updatedAt;
    return;
  }

  if (!candidate.updatedAt) {
    return;
  }

  if (!aggregate.updatedAt) {
    aggregate.value = candidateValue;
    aggregate.dateValue = candidate.dateValue ?? null;
    aggregate.updatedAt = candidate.updatedAt;
    return;
  }

  if (compareTimestamps(candidate.updatedAt, aggregate.updatedAt) >= 0) {
    aggregate.value = candidateValue;
    aggregate.dateValue = candidate.dateValue ?? null;
    aggregate.updatedAt = candidate.updatedAt;
  }
}

function extractTodoProjectFieldValues(
  raw: IssueRaw | null,
  targetProject: string | null,
): TodoProjectFieldValues {
  const result: TodoProjectFieldValues = {
    priority: null,
    priorityUpdatedAt: null,
    weight: null,
    weightUpdatedAt: null,
    initiationOptions: null,
    initiationOptionsUpdatedAt: null,
    startDate: null,
    startDateUpdatedAt: null,
  };

  if (!raw || !raw.projectItems || typeof raw.projectItems !== "object") {
    return result;
  }

  const connection = raw.projectItems as { nodes?: unknown };
  const nodes = Array.isArray(connection.nodes)
    ? (connection.nodes as unknown[])
    : [];

  const priorityAggregate = createProjectFieldAggregate();
  const weightAggregate = createProjectFieldAggregate();
  const initiationAggregate = createProjectFieldAggregate();
  const startAggregate = createProjectFieldAggregate();

  nodes.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    const projectRecord = record.project;
    const projectTitle =
      projectRecord && typeof projectRecord === "object"
        ? (projectRecord as { title?: unknown }).title
        : null;

    if (!matchProject(projectTitle, targetProject)) {
      return;
    }

    const fallbackTimestamps: string[] = [];
    const updatedAt =
      typeof record.updatedAt === "string" ? record.updatedAt.trim() : null;
    if (updatedAt?.length) {
      fallbackTimestamps.push(updatedAt);
    }
    const createdAt =
      typeof record.createdAt === "string" ? record.createdAt.trim() : null;
    if (createdAt?.length) {
      fallbackTimestamps.push(createdAt);
    }

    applyProjectFieldCandidate(
      priorityAggregate,
      extractProjectFieldValueInfo(
        (record as { priority?: unknown }).priority,
        fallbackTimestamps,
      ),
    );
    applyProjectFieldCandidate(
      weightAggregate,
      extractProjectFieldValueInfo(
        (record as { weight?: unknown }).weight,
        fallbackTimestamps,
      ),
    );
    applyProjectFieldCandidate(
      initiationAggregate,
      extractProjectFieldValueInfo(
        (record as { initiationOptions?: unknown }).initiationOptions,
        fallbackTimestamps,
      ),
    );
    applyProjectFieldCandidate(
      startAggregate,
      extractProjectFieldValueInfo(
        (record as { startDate?: unknown }).startDate,
        fallbackTimestamps,
      ),
    );
  });

  return {
    priority: normalizePriorityText(priorityAggregate.value),
    priorityUpdatedAt: priorityAggregate.updatedAt,
    weight: normalizeWeightText(weightAggregate.value),
    weightUpdatedAt: weightAggregate.updatedAt,
    initiationOptions: initiationAggregate.value,
    initiationOptionsUpdatedAt: initiationAggregate.updatedAt,
    startDate: startAggregate.dateValue ?? startAggregate.value,
    startDateUpdatedAt: startAggregate.updatedAt,
  };
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
  const reviewRequestDetails = new Map<string, ReviewRequestAttentionItem[]>();
  const mentionDetails = new Map<string, MentionAttentionItem[]>();

  insights.unansweredMentions.forEach((item) => {
    if (item.waitingDays >= thresholds.unansweredMentionDays) {
      const id = item.container.id;
      if (id) {
        unansweredMentions.add(id);
      }
    }

    const containerId = item.container.id;
    if (containerId) {
      const existing = mentionDetails.get(containerId) ?? [];
      existing.push(item);
      mentionDetails.set(containerId, existing);
    }
  });

  insights.stuckReviewRequests.forEach((item) => {
    if (item.waitingDays >= thresholds.reviewRequestDays) {
      reviewRequests.add(item.pullRequest.id);
    }

    const pullRequestId = item.pullRequest.id;
    const existing = reviewRequestDetails.get(pullRequestId) ?? [];
    existing.push(item);
    reviewRequestDetails.set(pullRequestId, existing);
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
    reviewRequestDetails,
    mentionDetails,
  };
}

function collectAttentionFilterIds(
  filters: ActivityAttentionFilter[] | undefined,
  sets: AttentionSets,
): AttentionFilterSelection | null {
  if (!filters?.length) {
    return null;
  }

  const union = new Set<string>();
  let includeNone = false;
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
      case "no_attention":
        includeNone = true;
        break;
      default:
        break;
    }
  });

  return {
    includeIds: Array.from(union),
    includeNone,
  };
}

function toStatus(value: string | null): "open" | "closed" | "merged" {
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

function toIsoWithFallback(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return toIso(value) ?? value;
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return toIso(value);
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
  attentionSelection: AttentionFilterSelection | null,
  attentionSets: AttentionSets,
  excludedRepositoryIds: string[] = [],
): {
  clauses: string[];
  values: unknown[];
  issueProjectStatuses: IssueProjectStatus[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const issueProjectStatuses: IssueProjectStatus[] = [];
  const excludedRepoIds = excludedRepositoryIds.filter(
    (id) => typeof id === "string" && id.length > 0,
  );

  if (excludedRepoIds.length > 0) {
    values.push(excludedRepoIds);
    clauses.push(
      `(items.repository_id IS NULL OR items.repository_id <> ALL($${values.length}::text[]))`,
    );
  }
  const buildNormalizedStatusExpr = (alias: string) => {
    const valueExpr = `LOWER(TRIM(${alias}.issue_display_status))`;
    return `(CASE
      WHEN ${alias}.item_type <> 'issue' THEN NULL
      WHEN ${alias}.issue_display_status IS NULL THEN 'no_status'
      WHEN ${valueExpr} = '' THEN 'no_status'
      WHEN ${valueExpr} IN ('todo', 'to do', 'to_do') THEN 'todo'
      WHEN ${valueExpr} LIKE '%progress%' OR ${valueExpr} = 'doing' OR ${valueExpr} = 'in-progress' THEN 'in_progress'
      WHEN ${valueExpr} IN ('done', 'completed', 'complete', 'finished', 'closed') THEN 'done'
      WHEN ${valueExpr} LIKE 'pending%' OR ${valueExpr} = 'waiting' THEN 'pending'
      WHEN ${valueExpr} IN ('canceled', 'cancelled') THEN 'canceled'
      ELSE 'no_status'
    END)`;
  };

  const haveSameMembers = (first: string[], second: string[]) => {
    if (first.length !== second.length) {
      return false;
    }
    const baseline = new Set(first);
    if (baseline.size !== second.length) {
      return false;
    }
    return second.every((value) => baseline.has(value));
  };

  const mergedStringSet = (values: string[]) =>
    Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

  const peopleFiltersConfig = [
    {
      values: params.authorIds ?? [],
      buildClause: (parameterIndex: number) =>
        `items.author_id = ANY($${parameterIndex}::text[])`,
    },
    {
      values: params.assigneeIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.assignee_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.reviewerIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.reviewer_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.mentionedUserIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.mentioned_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.commenterIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.commenter_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.reactorIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.reactor_ids && $${parameterIndex}::text[], FALSE)`,
    },
  ] as const;

  const populatedPeopleFilters = peopleFiltersConfig.filter(
    (entry) => entry.values.length > 0,
  );

  let peopleFiltersHandled = false;

  if (populatedPeopleFilters.length > 0) {
    const baselineValues = mergedStringSet(
      populatedPeopleFilters[0]?.values ?? [],
    );
    const isSyncedSelection = populatedPeopleFilters.every((entry) =>
      haveSameMembers(baselineValues, mergedStringSet(entry.values)),
    );

    if (isSyncedSelection) {
      values.push(baselineValues);
      const parameterIndex = values.length;
      const peopleClauses = populatedPeopleFilters.map((entry) =>
        entry.buildClause(parameterIndex),
      );
      clauses.push(`(${peopleClauses.join(" OR ")})`);
      peopleFiltersHandled = true;
    }
  }

  if (attentionSelection) {
    const { includeIds, includeNone } = attentionSelection;
    const ensureExclusionClause = () => {
      const fragments: string[] = [];
      const setsInOrder: Array<Set<string>> = [
        attentionSets.unansweredMentions,
        attentionSets.reviewRequests,
        attentionSets.stalePullRequests,
        attentionSets.idlePullRequests,
        attentionSets.backlogIssues,
        attentionSets.stalledIssues,
      ];
      setsInOrder.forEach((set) => {
        if (!set.size) {
          return;
        }
        values.push(Array.from(set));
        fragments.push(`items.id = ANY($${values.length}::text[])`);
      });
      return fragments;
    };

    if (!includeNone && includeIds.length > 0) {
      values.push(includeIds);
      clauses.push(`items.id = ANY($${values.length}::text[])`);
    } else if (includeNone && includeIds.length === 0) {
      const exclusionClauses = ensureExclusionClause();
      if (exclusionClauses.length > 0) {
        clauses.push(`NOT (${exclusionClauses.join(" OR ")})`);
      }
    } else if (includeNone && includeIds.length > 0) {
      values.push(includeIds);
      const includeIndex = values.length;
      const exclusionClauses = ensureExclusionClause();
      let condition = `items.id = ANY($${includeIndex}::text[])`;
      if (exclusionClauses.length > 0) {
        condition = `(${condition} OR NOT (${exclusionClauses.join(" OR ")}))`;
      }
      clauses.push(condition);
    }
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

  if (params.issueTypeIds?.length) {
    values.push(params.issueTypeIds);
    clauses.push(
      `(items.item_type <> 'issue' OR items.issue_type_id = ANY($${values.length}::text[]))`,
    );
  }

  if (params.issuePriorities?.length) {
    values.push(params.issuePriorities);
    clauses.push(
      `(items.item_type <> 'issue' OR items.issue_priority_value = ANY($${values.length}::text[]))`,
    );
  }

  if (params.issueWeights?.length) {
    values.push(params.issueWeights);
    clauses.push(
      `(items.item_type <> 'issue' OR items.issue_weight_value = ANY($${values.length}::text[]))`,
    );
  }

  if (params.milestoneIds?.length) {
    values.push(params.milestoneIds);
    clauses.push(
      `(items.item_type <> 'issue' OR items.milestone_id = ANY($${values.length}::text[]))`,
    );
  }

  if (params.pullRequestStatuses?.length) {
    const unique = Array.from(new Set(params.pullRequestStatuses));
    if (unique.length > 0 && unique.length < PR_STATUS_VALUES.length) {
      const mapped = unique.map((status) => PR_STATUS_MAP[status]);
      values.push(mapped);
      clauses.push(
        `(items.item_type <> 'pull_request' OR items.status = ANY($${values.length}::text[]))`,
      );
    }
  }

  if (params.issueBaseStatuses?.length) {
    const unique = Array.from(new Set(params.issueBaseStatuses));
    if (unique.length > 0 && unique.length < ISSUE_BASE_STATUS_VALUES.length) {
      const mapped = unique.map((status) => ISSUE_BASE_STATUS_MAP[status]);
      values.push(mapped);
      clauses.push(
        `(items.item_type <> 'issue' OR items.status = ANY($${values.length}::text[]))`,
      );
    }
  }

  if (!peopleFiltersHandled && params.authorIds?.length) {
    values.push(params.authorIds);
    clauses.push(`items.author_id = ANY($${values.length}::text[])`);
  }

  if (!peopleFiltersHandled && params.assigneeIds?.length) {
    const unique = mergedStringSet(params.assigneeIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.assignee_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.reviewerIds?.length) {
    const unique = mergedStringSet(params.reviewerIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.reviewer_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.mentionedUserIds?.length) {
    const unique = mergedStringSet(params.mentionedUserIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.mentioned_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.commenterIds?.length) {
    const unique = mergedStringSet(params.commenterIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.commenter_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.reactorIds?.length) {
    const unique = mergedStringSet(params.reactorIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.reactor_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (params.linkedIssueStates?.length) {
    const filters = new Set(params.linkedIssueStates);
    if (filters.has("has_sub")) {
      clauses.push(
        `(items.item_type <> 'issue' OR items.tracked_issues_count > 0)`,
      );
    }
    if (filters.has("has_parent")) {
      clauses.push(
        `(items.item_type <> 'issue' OR items.tracked_issues_count = 0)`,
      );
    }
  }

  if (params.statuses?.length) {
    const statuses = params.statuses;
    const baseStatuses = statuses.filter(
      (status): status is "open" | "closed" =>
        status === "open" || status === "closed",
    );
    const includeMerged = statuses.includes("merged");
    issueProjectStatuses.push(
      ...statuses.filter((status): status is IssueProjectStatus =>
        ISSUE_PROJECT_STATUS_SET.has(status as IssueProjectStatus),
      ),
    );

    if (baseStatuses.length || includeMerged) {
      if (includeMerged) {
        values.push(["merged"]);
        const mergedIndex = values.length;
        if (baseStatuses.length) {
          values.push(baseStatuses);
          clauses.push(
            `((items.item_type = 'pull_request' AND items.status = ANY($${mergedIndex}::text[])) OR (items.item_type <> 'pull_request' AND items.status = ANY($${values.length}::text[])))`,
          );
        } else {
          clauses.push(
            `items.item_type = 'pull_request' AND items.status = ANY($${mergedIndex}::text[])`,
          );
        }
      } else {
        values.push(baseStatuses);
        clauses.push(`items.status = ANY($${values.length}::text[])`);
      }
    }

    if (issueProjectStatuses.length) {
      const uniqueIssueStatuses = Array.from(new Set(issueProjectStatuses));
      values.push(uniqueIssueStatuses);
      const issueStatusParamIndex = values.length;
      const normalizedStatusExpr = buildNormalizedStatusExpr("items");
      clauses.push(
        `(items.item_type <> 'issue' OR ${normalizedStatusExpr} = ANY($${issueStatusParamIndex}::text[]))`,
      );
      issueProjectStatuses.splice(
        0,
        issueProjectStatuses.length,
        ...uniqueIssueStatuses,
      );
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

  return { clauses, values, issueProjectStatuses };
}

function buildBaseQuery(targetProject: string | null): string {
  const mapProjectStatus = (valueExpr: string) => `(CASE
    WHEN ${valueExpr} IN ('', 'no', 'no_status') THEN 'no_status'
    WHEN ${valueExpr} IN ('todo', 'to_do', 'to do') THEN 'todo'
    WHEN ${valueExpr} LIKE 'in_progress%' OR ${valueExpr} = 'doing' OR ${valueExpr} = 'in-progress' THEN 'in_progress'
    WHEN ${valueExpr} IN ('done', 'completed', 'complete', 'finished', 'closed') THEN 'done'
    WHEN ${valueExpr} LIKE 'pending%' OR ${valueExpr} = 'waiting' THEN 'pending'
    WHEN ${valueExpr} IN ('canceled', 'cancelled') THEN 'canceled'
    WHEN ${valueExpr} LIKE '%project_removed%' THEN 'no_status'
    ELSE NULL
  END)`;

  const todoProjectStatusSelection =
    targetProject === null
      ? "NULL"
      : `(SELECT mapped.status_value
          FROM (
            SELECT ${mapProjectStatus(
              "normalized.normalized_status",
            )} AS status_value,
                   normalized.occurred_at AS occurred_at
            FROM (
              SELECT
                REGEXP_REPLACE(LOWER(COALESCE(entry->>'status', '')), '[^a-z0-9]+', '_', 'g') AS normalized_status,
                entry->>'occurredAt' AS occurred_at,
                LOWER(TRIM(COALESCE(
                  entry->>'projectTitle',
                  entry->'project'->>'title',
                  entry->'project'->>'name',
                  ''
                ))) AS project_name
              FROM jsonb_array_elements(COALESCE(i.data->'projectStatusHistory', '[]'::jsonb)) AS entry
            ) AS normalized
            WHERE normalized.project_name = '${escapeSqlLiteral(targetProject)}'
          ) AS mapped
          WHERE mapped.status_value IS NOT NULL
          ORDER BY COALESCE(mapped.occurred_at, '') DESC NULLS LAST
          LIMIT 1)`;
  const todoProjectStatusAtSelection =
    targetProject === null
      ? "NULL"
      : `(SELECT mapped.occurred_at
          FROM (
            SELECT ${mapProjectStatus(
              "normalized.normalized_status",
            )} AS status_value,
                   normalized.occurred_at AS occurred_at
            FROM (
              SELECT
                REGEXP_REPLACE(LOWER(COALESCE(entry->>'status', '')), '[^a-z0-9]+', '_', 'g') AS normalized_status,
                entry->>'occurredAt' AS occurred_at,
                LOWER(TRIM(COALESCE(
                  entry->>'projectTitle',
                  entry->'project'->>'title',
                  entry->'project'->>'name',
                  ''
                ))) AS project_name
              FROM jsonb_array_elements(COALESCE(i.data->'projectStatusHistory', '[]'::jsonb)) AS entry
            ) AS normalized
            WHERE normalized.project_name = '${escapeSqlLiteral(targetProject)}'
          ) AS mapped
          WHERE mapped.status_value IS NOT NULL
          ORDER BY COALESCE(mapped.occurred_at, '') DESC NULLS LAST
          LIMIT 1)`;

  const issueProjectStatusExpr =
    targetProject === null
      ? "'no_status'"
      : `COALESCE(${todoProjectStatusSelection}, 'no_status')`;
  const issueProjectStatusAtExpr =
    targetProject === null
      ? "NULL::timestamptz"
      : `${todoProjectStatusAtSelection}::timestamptz`;

  const projectMatchExpr =
    targetProject === null
      ? "FALSE"
      : `LOWER(TRIM(COALESCE(
           node->'project'->>'title',
           node->'project'->>'name',
           node->>'projectTitle',
           ''
         ))) = '${escapeSqlLiteral(targetProject)}'`;
  const priorityValueExpr = `NULLIF(TRIM(COALESCE(
    node->'priority'->>'name',
    node->'priority'->>'title',
    node->'priority'->>'text',
    node->'priority'->>'date',
    node->'priority'->>'number'
  )), '')`;
  const priorityUpdatedAtExpr = `NULLIF(TRIM(COALESCE(
    node->'priority'->>'updatedAt',
    node->>'updatedAt',
    node->>'createdAt'
  )), '')`;
  const weightValueExpr = `NULLIF(TRIM(COALESCE(
    node->'weight'->>'name',
    node->'weight'->>'title',
    node->'weight'->>'text',
    node->'weight'->>'number'
  )), '')`;
  const weightUpdatedAtExpr = `NULLIF(TRIM(COALESCE(
    node->'weight'->>'updatedAt',
    node->>'updatedAt',
    node->>'createdAt'
  )), '')`;
  const lockedStatusExpr = `(${issueProjectStatusExpr} IN ('in_progress', 'done', 'pending'))`;

  return /* sql */ `
WITH activity_status AS (
  SELECT DISTINCT ON (issue_id)
    issue_id,
    status,
    occurred_at
  FROM activity_issue_status_history
  ORDER BY issue_id, occurred_at DESC
),
issue_items AS (
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
    COALESCE(
      NULLIF(i.data->'issueType'->>'id', ''),
      CASE
        WHEN COALESCE(labels.has_bug_label, FALSE) THEN 'label:issue_type:bug'
        WHEN COALESCE(labels.has_feature_label, FALSE) THEN 'label:issue_type:feature'
        WHEN COALESCE(labels.has_task_label, FALSE) THEN 'label:issue_type:task'
        ELSE NULL
      END
    ) AS issue_type_id,
    COALESCE(
      NULLIF(i.data->'issueType'->>'name', ''),
      CASE
        WHEN COALESCE(labels.has_bug_label, FALSE) THEN 'Bug'
        WHEN COALESCE(labels.has_feature_label, FALSE) THEN 'Feature'
        WHEN COALESCE(labels.has_task_label, FALSE) THEN 'Task'
        ELSE NULL
      END
    ) AS issue_type_name,
    NULLIF(i.data->'milestone'->>'id', '') AS milestone_id,
    NULLIF(i.data->'milestone'->>'title', '') AS milestone_title,
    NULLIF(i.data->'milestone'->>'state', '') AS milestone_state,
    NULLIF(i.data->'milestone'->>'dueOn', '') AS milestone_due_on,
    NULLIF(i.data->'milestone'->>'url', '') AS milestone_url,
    COALESCE(
      NULLIF(i.data->'trackedIssues'->>'totalCount', '')::integer,
      0
    ) AS tracked_issues_count,
    COALESCE(
      NULLIF(i.data->'trackedInIssues'->>'totalCount', '')::integer,
      0
    ) AS tracked_in_issues_count,
    i.github_created_at AS created_at,
    i.github_updated_at AS updated_at,
    i.github_closed_at AS closed_at,
    NULL::timestamptz AS merged_at,
    FALSE AS is_merged,
    i.data AS raw_data,
    COALESCE(i.data->'projectStatusHistory', '[]'::jsonb) AS project_history,
    ${issueProjectStatusExpr} AS issue_project_status,
    ${issueProjectStatusAtExpr} AS issue_project_status_at,
    ${lockedStatusExpr} AS issue_project_status_locked,
    ${normalizePrioritySql(`CASE
      WHEN ${lockedStatusExpr}
        THEN priority_fields.priority_value
      ELSE COALESCE(
        NULLIF(BTRIM(overrides.priority_value), ''),
        priority_fields.priority_value
      )
    END`)} AS issue_priority_value,
    ${normalizeWeightSql(`CASE
      WHEN ${lockedStatusExpr}
        THEN weight_fields.weight_value
      ELSE COALESCE(
        NULLIF(BTRIM(overrides.weight_value), ''),
        weight_fields.weight_value
      )
    END`)} AS issue_weight_value,
    COALESCE(i.data->>'body', '') AS body_text,
    recent_status.status AS activity_status,
    recent_status.occurred_at AS activity_status_at
  FROM issues i
  JOIN repositories repo ON repo.id = i.repository_id
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT node->>'id') FILTER (WHERE node->>'id' IS NOT NULL) AS assignee_ids
    FROM jsonb_array_elements(COALESCE(i.data->'assignees'->'nodes', '[]'::jsonb)) AS node
  ) assignees ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT CONCAT(repo.name_with_owner, ':', label_node->>'name')) FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_keys,
      ARRAY_AGG(DISTINCT label_node->>'name') FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_names,
      BOOL_OR(LOWER(label_node->>'name') = 'bug') AS has_bug_label,
      BOOL_OR(LOWER(label_node->>'name') IN ('feature', 'feature request', 'enhancement')) AS has_feature_label,
      BOOL_OR(LOWER(label_node->>'name') IN ('task', 'todo', 'chore')) AS has_task_label
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
  LEFT JOIN LATERAL (
    SELECT
      ${priorityValueExpr} AS priority_value,
      ${priorityUpdatedAtExpr} AS priority_updated_at
    FROM jsonb_array_elements(COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)) AS node
    WHERE ${projectMatchExpr}
      AND ${priorityValueExpr} IS NOT NULL
    ORDER BY COALESCE(${priorityUpdatedAtExpr}, '') DESC NULLS LAST
    LIMIT 1
  ) priority_fields ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ${weightValueExpr} AS weight_value,
      ${weightUpdatedAtExpr} AS weight_updated_at
    FROM jsonb_array_elements(COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)) AS node
    WHERE ${projectMatchExpr}
      AND ${weightValueExpr} IS NOT NULL
    ORDER BY COALESCE(${weightUpdatedAtExpr}, '') DESC NULLS LAST
    LIMIT 1
  ) weight_fields ON TRUE
  LEFT JOIN activity_issue_project_overrides overrides ON overrides.issue_id = i.id
  LEFT JOIN activity_status recent_status ON recent_status.issue_id = i.id
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
    NULL::text AS issue_type_id,
    NULL::text AS issue_type_name,
    NULL::text AS milestone_id,
    NULL::text AS milestone_title,
    NULL::text AS milestone_state,
    NULL::text AS milestone_due_on,
    NULL::text AS milestone_url,
    0::integer AS tracked_issues_count,
    0::integer AS tracked_in_issues_count,
    pr.github_created_at AS created_at,
    pr.github_updated_at AS updated_at,
    pr.github_closed_at AS closed_at,
    pr.github_merged_at AS merged_at,
    COALESCE(pr.merged, FALSE) AS is_merged,
    pr.data AS raw_data,
    '[]'::jsonb AS project_history,
    NULL::text AS issue_project_status,
    NULL::timestamptz AS issue_project_status_at,
    FALSE AS issue_project_status_locked,
    NULL::text AS issue_priority_value,
    NULL::text AS issue_weight_value,
    COALESCE(pr.data->>'body', '') AS body_text,
    NULL::text AS activity_status,
    NULL::timestamptz AS activity_status_at
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
    issue_project_status,
    issue_project_status_at,
    issue_project_status_locked,
    issue_priority_value,
    issue_weight_value,
    activity_status,
    activity_status_at,
    (CASE
      WHEN issue_project_status_locked AND issue_project_status IS NOT NULL THEN issue_project_status
      WHEN activity_status IS NOT NULL
        AND activity_status_at IS NOT NULL
        AND (issue_project_status_at IS NULL OR activity_status_at >= issue_project_status_at)
        THEN COALESCE(activity_status, issue_project_status, 'no_status')
      WHEN issue_project_status_at IS NOT NULL THEN COALESCE(issue_project_status, 'no_status')
      WHEN activity_status_at IS NOT NULL THEN COALESCE(activity_status, issue_project_status, 'no_status')
      ELSE COALESCE(activity_status, issue_project_status, 'no_status')
    END) AS issue_display_status,
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
    issue_project_status,
    issue_project_status_at,
    issue_project_status_locked,
    issue_priority_value,
    issue_weight_value,
    activity_status,
    activity_status_at,
    NULL::text AS issue_display_status,
    body_text,
    CASE
      WHEN is_merged THEN 'merged'
      WHEN closed_at IS NOT NULL OR LOWER(state) = 'closed' THEN 'closed'
      ELSE 'open'
    END AS status
  FROM pr_items
)
`;
}

async function fetchJumpPage(
  baseQuery: string,
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
    `${baseQuery}
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

  if (row.item_type === "discussion") {
    return {
      unansweredMention: sets.unansweredMentions.has(row.id),
      reviewRequestPending: false,
      staleOpenPr: false,
      idlePr: false,
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
  projectOverrides: Map<string, ProjectFieldOverrides>,
  activityStatusHistory: Map<string, ActivityStatusEvent[]>,
  linkedIssuesMap: Map<string, ActivityLinkedIssue[]>,
  linkedPullRequestsMap: Map<string, ActivityLinkedPullRequest[]>,
): ActivityItem {
  const status = toStatus(row.status);
  let issueProjectStatus: IssueProjectStatus | null = null;
  let issueProjectStatusSource: ActivityItem["issueProjectStatusSource"] =
    "none";
  let issueProjectStatusLocked = false;
  let issueTodoProjectStatus: IssueProjectStatus | null = null;
  let issueTodoProjectStatusAt: string | null = null;
  let issueActivityStatus: IssueProjectStatus | null = null;
  let issueActivityStatusAt: string | null = null;
  let issueTodoProjectPriorityValue: string | null = null;
  let issueTodoProjectPriorityUpdatedAtValue: string | null = null;
  let issueTodoProjectWeightValue: string | null = null;
  let issueTodoProjectWeightUpdatedAtValue: string | null = null;
  let issueTodoProjectInitiationOptionsValue: string | null = null;
  let issueTodoProjectInitiationOptionsUpdatedAtValue: string | null = null;
  let issueTodoProjectStartDateValue: string | null = null;
  let issueTodoProjectStartDateUpdatedAtValue: string | null = null;
  const labels = buildLabels(row);
  const hasParentIssue =
    row.item_type === "issue" && (row.tracked_in_issues_count ?? 0) > 0;
  const hasSubIssues =
    row.item_type === "issue" && (row.tracked_issues_count ?? 0) > 0;
  const issueType =
    row.item_type === "issue" && row.issue_type_id
      ? {
          id: row.issue_type_id,
          name: row.issue_type_name ?? null,
        }
      : null;
  const milestone =
    row.item_type === "issue" && row.milestone_id
      ? {
          id: row.milestone_id,
          title: row.milestone_title ?? null,
          state: row.milestone_state ?? null,
          dueOn: toIso(row.milestone_due_on),
          url: row.milestone_url ?? null,
        }
      : null;

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

  if (row.item_type === "issue") {
    const raw = parseIssueRaw(row.raw_data);
    const todoProjectFields = extractTodoProjectFieldValues(raw, targetProject);
    issueTodoProjectPriorityValue = todoProjectFields.priority;
    issueTodoProjectPriorityUpdatedAtValue =
      todoProjectFields.priorityUpdatedAt;
    issueTodoProjectWeightValue = todoProjectFields.weight;
    issueTodoProjectWeightUpdatedAtValue = todoProjectFields.weightUpdatedAt;
    issueTodoProjectInitiationOptionsValue =
      todoProjectFields.initiationOptions;
    issueTodoProjectInitiationOptionsUpdatedAtValue =
      todoProjectFields.initiationOptionsUpdatedAt;
    issueTodoProjectStartDateValue = todoProjectFields.startDate;
    issueTodoProjectStartDateUpdatedAtValue =
      todoProjectFields.startDateUpdatedAt;
    const activityEvents = activityStatusHistory.get(row.id) ?? [];
    const statusInfo = resolveIssueStatusInfo(
      raw,
      targetProject,
      activityEvents,
    );
    issueProjectStatus = statusInfo.displayStatus;
    issueProjectStatusSource = statusInfo.source;
    issueProjectStatusLocked = statusInfo.locked;
    issueTodoProjectStatus = statusInfo.todoStatus;
    issueTodoProjectStatusAt = statusInfo.todoStatusAt;
    issueActivityStatus = statusInfo.activityStatus;
    issueActivityStatusAt = statusInfo.activityStatusAt;

    if (!issueProjectStatusLocked) {
      const overrides = projectOverrides.get(row.id);
      if (overrides) {
        if (overrides.priority) {
          issueTodoProjectPriorityValue = normalizePriorityText(
            overrides.priority,
          );
          issueTodoProjectPriorityUpdatedAtValue =
            overrides.priorityUpdatedAt ??
            issueTodoProjectPriorityUpdatedAtValue;
        }
        if (overrides.initiationOptions) {
          issueTodoProjectInitiationOptionsValue = overrides.initiationOptions;
          issueTodoProjectInitiationOptionsUpdatedAtValue =
            overrides.initiationOptionsUpdatedAt ??
            issueTodoProjectInitiationOptionsUpdatedAtValue;
        }
        if (overrides.weight) {
          issueTodoProjectWeightValue = normalizeWeightText(overrides.weight);
          issueTodoProjectWeightUpdatedAtValue =
            overrides.weightUpdatedAt ?? issueTodoProjectWeightUpdatedAtValue;
        }
        if (overrides.startDate) {
          issueTodoProjectStartDateValue = overrides.startDate;
          issueTodoProjectStartDateUpdatedAtValue =
            overrides.startDateUpdatedAt ??
            issueTodoProjectStartDateUpdatedAtValue;
        }
      }
    }

    const { startedAt, completedAt } = resolveWorkTimestamps(statusInfo);
    if (startedAt) {
      const startDate = new Date(startedAt);
      businessDaysSinceInProgress = differenceInBusinessDaysOrNull(
        startDate,
        now,
        HOLIDAY_SET,
      );
      if (status !== "open" && row.closed_at) {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startDate,
          new Date(row.closed_at),
          HOLIDAY_SET,
        );
      } else if (statusInfo.timelineSource === "activity" && completedAt) {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startDate,
          new Date(completedAt),
          HOLIDAY_SET,
        );
      } else {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startDate,
          now,
          HOLIDAY_SET,
        );
      }
    }
  } else {
    issueProjectStatusSource = "none";
    issueProjectStatusLocked = false;
  }

  const reviewRequestDetails =
    sets.reviewRequestDetails.get(row.id) ??
    ([] as ReviewRequestAttentionItem[]);
  const dedupedReviewRequests =
    dedupeReviewRequestDetails(reviewRequestDetails);
  const reviewRequestWaits = dedupedReviewRequests.length
    ? dedupedReviewRequests.map((detail) => ({
        id: detail.id,
        reviewer: mapReferencedUser(detail.reviewer ?? null, users),
        requestedAt: toIso(detail.requestedAt),
        businessDaysWaiting: detail.waitingDays ?? null,
      }))
    : undefined;

  const mentionDetails =
    sets.mentionDetails.get(row.id) ?? ([] as MentionAttentionItem[]);
  const dedupedMentions = dedupeMentionDetails(mentionDetails);
  const mentionWaits = dedupedMentions.length
    ? dedupedMentions.map((detail) => ({
        id: detail.commentId,
        user: mapReferencedUser(detail.target ?? null, users),
        mentionedAt: toIso(detail.mentionedAt),
        businessDaysWaiting: detail.waitingDays ?? null,
      }))
    : undefined;
  const linkedPullRequests =
    linkedPullRequestsMap.get(row.id) ?? ([] as ActivityLinkedPullRequest[]);
  const linkedIssues =
    linkedIssuesMap.get(row.id) ?? ([] as ActivityLinkedIssue[]);

  return {
    id: row.id,
    type: row.item_type,
    number: row.number,
    title: row.title,
    url: row.url,
    state: row.state,
    status,
    issueProjectStatus,
    issueProjectStatusSource,
    issueProjectStatusLocked,
    issueTodoProjectStatus,
    issueTodoProjectStatusAt: issueTodoProjectStatusAt
      ? toIso(issueTodoProjectStatusAt)
      : null,
    issueTodoProjectPriority: issueTodoProjectPriorityValue,
    issueTodoProjectPriorityUpdatedAt: toIsoWithFallback(
      issueTodoProjectPriorityUpdatedAtValue,
    ),
    issueTodoProjectWeight: issueTodoProjectWeightValue,
    issueTodoProjectWeightUpdatedAt: toIsoWithFallback(
      issueTodoProjectWeightUpdatedAtValue,
    ),
    issueTodoProjectInitiationOptions: issueTodoProjectInitiationOptionsValue,
    issueTodoProjectInitiationOptionsUpdatedAt: toIsoWithFallback(
      issueTodoProjectInitiationOptionsUpdatedAtValue,
    ),
    issueTodoProjectStartDate: toIsoWithFallback(
      issueTodoProjectStartDateValue,
    ),
    issueTodoProjectStartDateUpdatedAt: toIsoWithFallback(
      issueTodoProjectStartDateUpdatedAtValue,
    ),
    issueActivityStatus,
    issueActivityStatusAt: issueActivityStatusAt
      ? toIso(issueActivityStatusAt)
      : null,
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
    issueType,
    milestone,
    linkedPullRequests,
    linkedIssues,
    hasParentIssue,
    hasSubIssues,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    closedAt: toIso(row.closed_at),
    mergedAt: toIso(row.merged_at),
    businessDaysOpen,
    businessDaysIdle,
    businessDaysSinceInProgress,
    businessDaysInProgressOpen,
    reviewRequestWaits,
    mentionWaits,
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
  return getCachedActivityFilterOptions();
}

export async function getActivityItems(
  params: ActivityListParams = {},
): Promise<ActivityListResult> {
  await ensureSchema();

  try {
    await ensureIssueStatusAutomation({ trigger: "activity:view" });
  } catch (error) {
    console.error(
      "[status-automation] Verification failed while loading activity items",
      error,
    );
  }

  const thresholds: Required<ActivityThresholds> = {
    ...DEFAULT_THRESHOLDS,
    ...params.thresholds,
  };

  const targetProject = normalizeText(env.TODO_PROJECT_NAME);
  const baseQuery = buildBaseQuery(targetProject);

  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, params.perPage ?? DEFAULT_PER_PAGE),
  );

  const attentionSets = await resolveAttentionSets(thresholds);
  const attentionSelection = collectAttentionFilterIds(
    params.attention,
    attentionSets,
  );
  const config = await getSyncConfig();
  const excludedRepositoryIds = Array.from(
    new Set(
      Array.isArray(config?.excluded_repository_ids)
        ? (config.excluded_repository_ids as unknown[])
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [],
    ),
  );
  if (
    attentionSelection &&
    !attentionSelection.includeNone &&
    attentionSelection.includeIds.length === 0
  ) {
    const dateTimeFormat = normalizeDateTimeDisplayFormat(
      typeof config?.date_time_format === "string"
        ? config.date_time_format
        : null,
    );
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
      dateTimeFormat,
    };
  }

  const { clauses, values } = buildQueryFilters(
    params,
    attentionSelection,
    attentionSets,
    excludedRepositoryIds,
  );

  let page = Math.max(1, params.page ?? 1);

  if (params.jumpToDate) {
    const jumpPage = await fetchJumpPage(
      baseQuery,
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
    `${baseQuery}
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
  const issueIds = rows
    .filter((row) => row.item_type === "issue")
    .map((row) => row.id);
  const pullRequestIds = rows
    .filter((row) => row.item_type === "pull_request")
    .map((row) => row.id);
  const [
    activityStatusHistory,
    projectOverrides,
    linkedPullRequestsMap,
    linkedIssuesMap,
  ] = await Promise.all([
    getActivityStatusHistory(issueIds),
    getProjectFieldOverrides(issueIds),
    getLinkedPullRequestsMap(issueIds),
    getLinkedIssuesMap(pullRequestIds),
  ]);
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

  const now = new Date();

  const items = rows.map((row) =>
    buildActivityItem(
      row,
      users,
      attentionSets,
      targetProject,
      now,
      projectOverrides,
      activityStatusHistory,
      linkedIssuesMap,
      linkedPullRequestsMap,
    ),
  );

  const dateTimeFormat = normalizeDateTimeDisplayFormat(
    typeof config?.date_time_format === "string"
      ? config.date_time_format
      : null,
  );

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
    dateTimeFormat,
  };
}

export async function getActivityItemDetail(
  id: string,
): Promise<ActivityItemDetail | null> {
  await ensureSchema();

  const thresholds: Required<ActivityThresholds> = { ...DEFAULT_THRESHOLDS };
  const attentionSets = await resolveAttentionSets(thresholds);
  const targetProject = normalizeText(env.TODO_PROJECT_NAME);
  const baseQuery = buildBaseQuery(targetProject);

  const result = await query<ActivityRow>(
    `${baseQuery}
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
  const now = new Date();
  const issueIds = row.item_type === "issue" ? [row.id] : [];
  const pullRequestIds = row.item_type === "pull_request" ? [row.id] : [];
  const [
    activityStatusHistory,
    projectOverrides,
    linkedPullRequestsMap,
    linkedIssuesMap,
  ] = await Promise.all([
    getActivityStatusHistory(issueIds),
    getProjectFieldOverrides(issueIds),
    getLinkedPullRequestsMap(issueIds),
    getLinkedIssuesMap(pullRequestIds),
  ]);
  const item = buildActivityItem(
    row,
    users,
    attentionSets,
    targetProject,
    now,
    projectOverrides,
    activityStatusHistory,
    linkedIssuesMap,
    linkedPullRequestsMap,
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
    todoStatusTimes: todoStatusTimes ?? undefined,
    activityStatusTimes: activityStatusTimes ?? undefined,
  };
}
