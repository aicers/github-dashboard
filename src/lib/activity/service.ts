import { normalizeProjectTarget } from "@/lib/activity/base-query";
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
import {
  extractProjectStatusEntries,
  mapIssueProjectStatus,
  matchProject,
  resolveIssueStatusInfo,
  resolveWorkTimestamps,
} from "@/lib/activity/status-utils";
import type {
  ActivityAttentionFilter,
  ActivityAttentionFlags,
  ActivityDiscussionStatusFilter,
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
  ActivityReactionGroup,
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
  loadCombinedHolidaySet,
} from "@/lib/dashboard/business-days";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { getSyncConfig, getUserProfiles } from "@/lib/db/operations";
import { env } from "@/lib/env";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";
import { readUserTimeSettings } from "@/lib/user/time-settings";

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

type AttentionFilterWithoutNone = Exclude<
  ActivityAttentionFilter,
  "no_attention"
>;

const ATTENTION_FILTER_KEYS: AttentionFilterWithoutNone[] = [
  "unanswered_mentions",
  "review_requests_pending",
  "pr_open_too_long",
  "pr_inactive",
  "issue_backlog",
  "issue_stalled",
];

async function fetchRepositoryMaintainers(repositoryIds: string[]) {
  if (!repositoryIds.length) {
    return new Map<string, string[]>();
  }

  const result = await query<{
    repository_id: string;
    maintainer_ids: string[] | null;
  }>(
    `SELECT repository_id,
            ARRAY_AGG(user_id ORDER BY user_id) AS maintainer_ids
       FROM repository_maintainers
      WHERE repository_id = ANY($1::text[])
      GROUP BY repository_id`,
    [repositoryIds],
  );

  const map = new Map<string, string[]>();
  result.rows.forEach((row) => {
    map.set(
      row.repository_id,
      Array.isArray(row.maintainer_ids) ? row.maintainer_ids : [],
    );
  });
  return map;
}

function normalizeOrganizationHolidayCodes(
  config: unknown,
): HolidayCalendarCode[] {
  if (
    !config ||
    !(config as { org_holiday_calendar_codes?: unknown })
      .org_holiday_calendar_codes
  ) {
    return [DEFAULT_HOLIDAY_CALENDAR];
  }

  const raw = (config as { org_holiday_calendar_codes?: unknown })
    .org_holiday_calendar_codes;
  if (!Array.isArray(raw)) {
    return [DEFAULT_HOLIDAY_CALENDAR];
  }

  const codes = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && isHolidayCalendarCode(value));

  if (!codes.length) {
    return [DEFAULT_HOLIDAY_CALENDAR];
  }

  return Array.from(new Set(codes)) as HolidayCalendarCode[];
}

const ISSUE_PROJECT_STATUS_VALUES: IssueProjectStatus[] = [
  "no_status",
  "todo",
  "in_progress",
  "done",
  "pending",
  "canceled",
];

const ISSUE_PROJECT_STATUS_SET = new Set(ISSUE_PROJECT_STATUS_VALUES);

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

const DISCUSSION_STATUS_VALUES: ActivityDiscussionStatusFilter[] = [
  "discussion_open",
  "discussion_closed",
];

const DISCUSSION_STATUS_MAP: Record<
  ActivityDiscussionStatusFilter,
  "open" | "closed"
> = {
  discussion_open: "open",
  discussion_closed: "closed",
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

type ReactionAggregateRow = {
  subject_id: string;
  content: string | null;
  count: number | string;
  reactor_ids: string[] | null;
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
  const byMention = new Map<string, MentionAttentionItem>();

  details.forEach((detail, index) => {
    const commentKey = detail.commentId?.trim() ?? `comment-${index}`;
    const targetKey = detail.target?.id?.trim();
    const tieBreaker =
      targetKey && targetKey.length > 0
        ? targetKey
        : (detail.mentionedAt?.trim() ?? `unknown-${index}`);
    const key = `${commentKey}::${tieBreaker}`;
    const existing = byMention.get(key);
    if (!existing || detail.waitingDays > existing.waitingDays) {
      byMention.set(key, detail);
    }
  });

  return Array.from(byMention.values());
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

function parseIssueRaw(data: unknown): IssueRaw | null {
  if (!data) {
    return null;
  }

  const record = parseRawRecord(data);
  if (!record) {
    return null;
  }

  return record as IssueRaw;
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
  options?: { userId?: string | null; useMentionClassifier?: boolean },
): Promise<AttentionSets> {
  const insights = await getAttentionInsights({
    userId: options?.userId ?? null,
    useMentionClassifier: options?.useMentionClassifier ?? true,
  });
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
  attentionSets: AttentionSets,
  excludedRepositoryIds: string[] = [],
): {
  clauses: string[];
  values: unknown[];
  issueProjectStatuses: IssueProjectStatus[];
  peopleSelection: string[];
  peopleSelectionParamIndex: number | null;
} {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const issueProjectStatuses: IssueProjectStatus[] = [];
  let peopleSelection: string[] = [];
  let peopleSelectionParamIndex: number | null = null;
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
    {
      values: params.maintainerIds ?? [],
      buildClause: (parameterIndex: number) =>
        `EXISTS (
           SELECT 1
           FROM repository_maintainers rm
           WHERE rm.repository_id = items.repository_id
             AND rm.user_id = ANY($${parameterIndex}::text[])
         )`,
    },
  ] as const;

  const populatedPeopleFilters = peopleFiltersConfig.filter(
    (entry) => entry.values.length > 0,
  );

  let peopleFiltersHandled = false;
  let peopleSelectionValues: string[] | null = null;

  const ensurePeopleSelectionParam = () => {
    if (!peopleSelectionValues || peopleSelectionValues.length === 0) {
      return null;
    }
    if (peopleSelectionParamIndex === null) {
      values.push(peopleSelectionValues);
      peopleSelectionParamIndex = values.length;
    }
    return peopleSelectionParamIndex;
  };

  const unansweredMentionTargets = new Map<string, Set<string>>();
  attentionSets.mentionDetails.forEach((details, itemId) => {
    const targets = new Set<string>();
    details.forEach((detail) => {
      const targetId = detail.target?.id?.trim();
      if (targetId) {
        targets.add(targetId);
      }
    });
    if (targets.size > 0) {
      unansweredMentionTargets.set(itemId, targets);
    }
  });

  if (populatedPeopleFilters.length > 0) {
    const baselineValues = mergedStringSet(
      populatedPeopleFilters[0]?.values ?? [],
    );
    const isSyncedSelection = populatedPeopleFilters.every((entry) =>
      haveSameMembers(baselineValues, mergedStringSet(entry.values)),
    );

    if (isSyncedSelection) {
      peopleSelection = baselineValues;
      peopleSelectionValues = baselineValues;
      const parameterIndex = ensurePeopleSelectionParam();
      if (parameterIndex !== null) {
        const peopleClauses = populatedPeopleFilters.map((entry) =>
          entry.buildClause(parameterIndex),
        );
        const hasActiveAttention =
          params.attention?.some((value) => value !== "no_attention") ?? false;
        if (!hasActiveAttention) {
          clauses.push(`(${peopleClauses.join(" OR ")})`);
        }
        peopleFiltersHandled = true;
      }
    }
  }

  if (!peopleSelectionValues && params.peopleSelection?.length) {
    const uniqueSelection = mergedStringSet(params.peopleSelection);
    if (uniqueSelection.length > 0) {
      peopleSelection = uniqueSelection;
      peopleSelectionValues = uniqueSelection;
    }
  }

  if (params.taskMode === "my_todo") {
    const selectionSet =
      peopleSelection.length > 0
        ? new Set(
            peopleSelection
              .map((value) => value?.trim())
              .filter((value): value is string => Boolean(value)),
          )
        : null;
    const selectionParamIndex = ensurePeopleSelectionParam();
    if (
      !selectionSet ||
      selectionSet.size === 0 ||
      selectionParamIndex === null
    ) {
      clauses.push("FALSE");
    } else {
      const assigneeCardinalityExpr =
        "COALESCE(array_length(items.assignee_ids, 1), 0)";
      const hasAssigneeExpr = `${assigneeCardinalityExpr} > 0`;
      const noAssigneeExpr = `${assigneeCardinalityExpr} = 0`;
      const buildAssigneeExpr = (index: number) =>
        `COALESCE(items.assignee_ids && $${index}::text[], FALSE)`;
      const buildMaintainerExpr = (index: number) =>
        `EXISTS (
           SELECT 1
           FROM repository_maintainers rm
           WHERE rm.repository_id = items.repository_id
             AND rm.user_id = ANY($${index}::text[])
         )`;
      const buildAuthorExpr = (index: number) =>
        `items.author_id = ANY($${index}::text[])`;
      const buildReviewerExpr = (index: number) =>
        `COALESCE(items.reviewer_ids && $${index}::text[], FALSE)`;

      const issueClause = `(items.item_type = 'issue' AND items.status = 'open' AND ((${hasAssigneeExpr} AND ${buildAssigneeExpr(
        selectionParamIndex,
      )}) OR (${noAssigneeExpr} AND ${buildMaintainerExpr(
        selectionParamIndex,
      )})))`;
      const pullRequestClause = `(items.item_type = 'pull_request' AND items.status = 'open' AND (${buildAuthorExpr(
        selectionParamIndex,
      )} OR ${buildReviewerExpr(selectionParamIndex)}))`;

      const mentionIds = Array.from(attentionSets.unansweredMentions).filter(
        (itemId) => {
          const targets = unansweredMentionTargets.get(itemId);
          if (!targets || targets.size === 0) {
            return false;
          }
          for (const candidate of selectionSet) {
            if (targets.has(candidate)) {
              return true;
            }
          }
          return false;
        },
      );

      const todoClauses = [issueClause, pullRequestClause];
      if (mentionIds.length > 0) {
        values.push(mentionIds);
        const mentionParameterIndex = values.length;
        todoClauses.push(`items.id = ANY($${mentionParameterIndex}::text[])`);
      }

      clauses.push(`(${todoClauses.join(" OR ")})`);
    }
  }

  const applyAttentionFilters = () => {
    if (!params.attention?.length) {
      return;
    }

    const uniqueFilters = Array.from(new Set(params.attention));
    if (uniqueFilters.length === 0) {
      return;
    }

    const includeNone = uniqueFilters.includes("no_attention");
    const activeFilters = uniqueFilters.filter(
      (value): value is AttentionFilterWithoutNone => value !== "no_attention",
    );

    const buildAttentionClause = (
      filter: AttentionFilterWithoutNone,
    ): string | null => {
      let ids: string[] = [];
      const constraints: string[] = [];
      const selectionSet =
        peopleSelection.length > 0
          ? new Set(
              peopleSelection
                .map((value) => value?.trim())
                .filter((value): value is string => Boolean(value)),
            )
          : null;

      const assigneeCardinalityExpr =
        "COALESCE(array_length(items.assignee_ids, 1), 0)";
      const hasAssigneeExpr = `${assigneeCardinalityExpr} > 0`;
      const noAssigneeExpr = `${assigneeCardinalityExpr} = 0`;
      const maintainerExistsExpr = `EXISTS (
         SELECT 1
         FROM repository_maintainers rm
         WHERE rm.repository_id = items.repository_id
       )`;

      const buildAssigneeExpr = (index: number) =>
        `COALESCE(items.assignee_ids && $${index}::text[], FALSE)`;
      const buildReviewerExpr = (index: number) =>
        `COALESCE(items.reviewer_ids && $${index}::text[], FALSE)`;
      const buildMentionedExpr = (index: number) =>
        `COALESCE(items.mentioned_ids && $${index}::text[], FALSE)`;
      const buildAuthorExpr = (index: number) =>
        `items.author_id = ANY($${index}::text[])`;
      const buildMaintainerExpr = (index: number) =>
        `EXISTS (
         SELECT 1
         FROM repository_maintainers rm
         WHERE rm.repository_id = items.repository_id
           AND rm.user_id = ANY($${index}::text[])
       )`;

      const withPeopleConstraint = (
        builder: (index: number) => string,
        options?: { required?: boolean },
      ) => {
        const paramIndex = ensurePeopleSelectionParam();
        if (paramIndex === null) {
          return options?.required ? null : undefined;
        }
        return builder(paramIndex);
      };

      switch (filter) {
        case "unanswered_mentions": {
          ids = Array.from(attentionSets.unansweredMentions);
          if (selectionSet && selectionSet.size > 0) {
            ids = ids.filter((itemId) => {
              const targets = unansweredMentionTargets.get(itemId);
              if (!targets || targets.size === 0) {
                return false;
              }
              for (const candidate of selectionSet) {
                if (targets.has(candidate)) {
                  return true;
                }
              }
              return false;
            });
            if (ids.length === 0) {
              return null;
            }
            const mentionExpr = withPeopleConstraint(buildMentionedExpr, {
              required: true,
            });
            if (!mentionExpr) {
              return null;
            }
            constraints.push(mentionExpr);
          }
          break;
        }
        case "review_requests_pending":
          ids = Array.from(attentionSets.reviewRequests);
          constraints.push(`items.item_type = 'pull_request'`);
          if (selectionSet && selectionSet.size > 0) {
            const reviewerExpr = withPeopleConstraint(buildReviewerExpr);
            if (reviewerExpr) {
              constraints.push(reviewerExpr);
            }
          }
          break;
        case "pr_open_too_long": {
          ids = Array.from(attentionSets.stalePullRequests);
          constraints.push(`items.item_type = 'pull_request'`);
          constraints.push(`items.status = 'open'`);
          if (selectionSet && selectionSet.size > 0) {
            const assigneeExpr = withPeopleConstraint(buildAssigneeExpr);
            const authorExpr = withPeopleConstraint(buildAuthorExpr);
            const reviewerExpr = withPeopleConstraint(buildReviewerExpr);
            const maintainerExpr = withPeopleConstraint(buildMaintainerExpr);
            const parts = [
              assigneeExpr,
              authorExpr,
              reviewerExpr,
              maintainerExpr,
            ].filter((expr): expr is string => Boolean(expr));
            if (parts.length) {
              constraints.push(`(${parts.join(" OR ")})`);
            }
          }
          break;
        }
        case "pr_inactive": {
          ids = Array.from(attentionSets.idlePullRequests);
          constraints.push(`items.item_type = 'pull_request'`);
          constraints.push(`items.status = 'open'`);
          if (selectionSet && selectionSet.size > 0) {
            const assigneeExpr = withPeopleConstraint(buildAssigneeExpr);
            const authorExpr = withPeopleConstraint(buildAuthorExpr);
            const reviewerExpr = withPeopleConstraint(buildReviewerExpr);
            const maintainerExpr = withPeopleConstraint(buildMaintainerExpr);
            const parts = [
              assigneeExpr,
              authorExpr,
              reviewerExpr,
              maintainerExpr,
            ].filter((expr): expr is string => Boolean(expr));
            if (parts.length) {
              constraints.push(`(${parts.join(" OR ")})`);
            }
          }
          break;
        }
        case "issue_backlog":
          ids = Array.from(attentionSets.backlogIssues);
          constraints.push(`items.item_type = 'issue'`);
          if (selectionSet && selectionSet.size > 0) {
            const maintainerExpr = withPeopleConstraint(buildMaintainerExpr);
            if (maintainerExpr) {
              constraints.push(maintainerExpr);
            }
          }
          break;
        case "issue_stalled":
          ids = Array.from(attentionSets.stalledIssues);
          constraints.push(`items.item_type = 'issue'`);
          if (selectionSet && selectionSet.size > 0) {
            const paramIndex = ensurePeopleSelectionParam();
            if (paramIndex !== null) {
              const personIsAssigneeExpr = buildAssigneeExpr(paramIndex);
              const personIsMaintainerExpr = buildMaintainerExpr(paramIndex);
              const personIsAuthorExpr = buildAuthorExpr(paramIndex);
              constraints.push(
                `((${hasAssigneeExpr} AND ${personIsAssigneeExpr}) OR (${noAssigneeExpr} AND ${maintainerExistsExpr} AND ${personIsMaintainerExpr}) OR (${noAssigneeExpr} AND NOT ${maintainerExistsExpr} AND ${personIsAuthorExpr}))`,
              );
            }
          }
          break;
        default:
          return null;
      }

      if (ids.length === 0) {
        return null;
      }

      values.push(ids);
      const parameterIndex = values.length;
      const baseClause = `items.id = ANY($${parameterIndex}::text[])`;
      if (!constraints.length) {
        return baseClause;
      }
      return `(${baseClause} AND ${constraints.join(" AND ")})`;
    };

    const attentionClauses = activeFilters
      .map((filter) => buildAttentionClause(filter))
      .filter((clause): clause is string => Boolean(clause));

    if (!includeNone) {
      if (attentionClauses.length === 0 && activeFilters.length > 0) {
        clauses.push("FALSE");
        return;
      }
      if (attentionClauses.length > 0) {
        clauses.push(`(${attentionClauses.join(" OR ")})`);
      }
      return;
    }

    const exclusionClauses = ATTENTION_FILTER_KEYS.map((filter) =>
      buildAttentionClause(filter),
    ).filter((clause): clause is string => Boolean(clause));

    const combinedMatch =
      attentionClauses.length > 0 ? `(${attentionClauses.join(" OR ")})` : null;
    const combinedExclusion =
      exclusionClauses.length > 0 ? `(${exclusionClauses.join(" OR ")})` : null;

    if (combinedMatch && combinedExclusion) {
      clauses.push(`(${combinedMatch} OR NOT ${combinedExclusion})`);
    } else if (combinedMatch) {
      clauses.push(combinedMatch);
    } else if (combinedExclusion) {
      clauses.push(`NOT ${combinedExclusion}`);
    }
  };

  applyAttentionFilters();

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

  if (params.discussionStatuses?.length) {
    const unique = Array.from(new Set(params.discussionStatuses));
    if (unique.length > 0 && unique.length < DISCUSSION_STATUS_VALUES.length) {
      const mapped = unique.map((status) => DISCUSSION_STATUS_MAP[status]);
      values.push(mapped);
      clauses.push(
        `(items.item_type <> 'discussion' OR items.status = ANY($${values.length}::text[]))`,
      );
    }
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

  return {
    clauses,
    values,
    issueProjectStatuses,
    peopleSelection,
    peopleSelectionParamIndex,
  };
}

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
  organizationHolidaySet: ReadonlySet<string>,
  now: Date,
  projectOverrides: Map<string, ProjectFieldOverrides>,
  activityStatusHistory: Map<string, ActivityStatusEvent[]>,
  linkedIssuesMap: Map<string, ActivityLinkedIssue[]>,
  linkedPullRequestsMap: Map<string, ActivityLinkedPullRequest[]>,
  repositoryMaintainers: Map<string, string[]>,
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
      ? differenceInBusinessDays(row.created_at, now, organizationHolidaySet)
      : differenceInBusinessDaysOrNull(
          row.created_at,
          now,
          organizationHolidaySet,
        );
  const businessDaysIdle = differenceInBusinessDaysOrNull(
    row.updated_at,
    now,
    organizationHolidaySet,
  );

  let businessDaysSinceInProgress: number | null | undefined = null;
  let businessDaysInProgressOpen: number | null | undefined = null;
  let discussionAnsweredAt: string | null = null;

  if (row.item_type === "discussion") {
    const rawDiscussion = parseRawRecord(row.raw_data);
    const answerChosenAt =
      rawDiscussion && typeof rawDiscussion.answerChosenAt === "string"
        ? rawDiscussion.answerChosenAt.trim()
        : "";
    if (answerChosenAt.length > 0) {
      discussionAnsweredAt = answerChosenAt;
    }
  }

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
        organizationHolidaySet,
      );
      if (status !== "open" && row.closed_at) {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startDate,
          new Date(row.closed_at),
          organizationHolidaySet,
        );
      } else if (statusInfo.timelineSource === "activity" && completedAt) {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startDate,
          new Date(completedAt),
          organizationHolidaySet,
        );
      } else {
        businessDaysInProgressOpen = differenceInBusinessDaysOrNull(
          startDate,
          now,
          organizationHolidaySet,
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
        userId: detail.target?.id ?? null,
        mentionedAt: toIso(detail.mentionedAt),
        businessDaysWaiting: detail.waitingDays ?? null,
        requiresResponse: detail.classification?.requiresResponse ?? null,
        manualRequiresResponse:
          detail.classification?.manualRequiresResponse ?? null,
        manualRequiresResponseAt:
          detail.classification?.manualRequiresResponseAt ?? null,
        manualDecisionIsStale:
          detail.classification?.manualDecisionIsStale ?? false,
        classifierEvaluatedAt: detail.classification?.lastEvaluatedAt ?? null,
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
    discussionAnsweredAt,
    repository: row.repository_id
      ? {
          id: row.repository_id,
          name: row.repository_name,
          nameWithOwner: row.repository_name_with_owner,
          maintainerIds: [
            ...(repositoryMaintainers.get(row.repository_id) ?? []),
          ],
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
  options?: { userId?: string | null },
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
  thresholds.unansweredMentionDays = Math.max(
    DEFAULT_THRESHOLDS.unansweredMentionDays,
    thresholds.unansweredMentionDays,
  );

  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);

  let page = Math.max(1, params.page ?? 1);

  const attentionSets = await resolveAttentionSets(thresholds, {
    userId: options?.userId ?? null,
    useMentionClassifier: params.useMentionAi !== false,
  });
  const attentionSelection = collectAttentionFilterIds(
    params.attention,
    attentionSets,
  );
  const [config, userTimeSettings] = await Promise.all([
    getSyncConfig(),
    readUserTimeSettings(options?.userId ?? null),
  ]);
  const perPagePreference = Math.min(
    MAX_PER_PAGE,
    Math.max(1, userTimeSettings.activityRowsPerPage ?? DEFAULT_PER_PAGE),
  );
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, params.perPage ?? perPagePreference),
  );
  const organizationHolidayCodes = normalizeOrganizationHolidayCodes(config);
  const organizationHolidaySet = await loadCombinedHolidaySet(
    organizationHolidayCodes,
  );
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
  const dateTimeFormat = userTimeSettings.dateTimeFormat;
  const trimmedTimezone = userTimeSettings.timezone.trim();
  const timezone = trimmedTimezone.length ? trimmedTimezone : null;
  const lastSyncCompletedAt = toIso(config?.last_sync_completed_at ?? null);
  const generatedAt = new Date().toISOString();

  if (
    attentionSelection &&
    !attentionSelection.includeNone &&
    attentionSelection.includeIds.length === 0
  ) {
    return {
      items: [],
      pageInfo: {
        page,
        perPage,
        totalCount: 0,
        totalPages: 0,
      },
      lastSyncCompletedAt,
      generatedAt,
      timezone,
      dateTimeFormat,
    };
  }

  const { clauses, values } = buildQueryFilters(
    params,
    attentionSets,
    excludedRepositoryIds,
  );

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
  const fetchLimit = perPage;
  const queryParams = [...values, fetchLimit, offset];

  const result = await query<ActivityRow>(
    `SELECT
       items.*
     FROM activity_items AS items
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
  const repositoryIds = Array.from(
    new Set(
      rows
        .map((row) => row.repository_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
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
    fetchRepositoryMaintainers(repositoryIds),
  ]);

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
      organizationHolidaySet,
      now,
      projectOverrides,
      activityStatusHistory,
      linkedIssuesMap,
      linkedPullRequestsMap,
      repositoryMaintainers,
    ),
  );

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM activity_items AS items
     WHERE 1 = 1${predicate}`,
    values,
  );

  const totalCount = Number(countResult.rows[0]?.count ?? 0);
  const totalPages =
    totalCount > 0 && perPage > 0
      ? Math.ceil(totalCount / perPage)
      : totalCount > 0
        ? 1
        : 0;

  return {
    items,
    pageInfo: {
      page,
      perPage,
      totalCount,
      totalPages,
    },
    lastSyncCompletedAt,
    generatedAt,
    timezone,
    dateTimeFormat,
  };
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
      coerceArray(reactionRow.reactor_ids).forEach((id) => {
        if (id) {
          reactorIdSet.add(id);
        }
      });
    });
    const missingReactorIds = Array.from(reactorIdSet).filter(
      (id) => id && !users.has(id),
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
