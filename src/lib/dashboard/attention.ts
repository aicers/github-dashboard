import { createHash } from "node:crypto";
import { normalizeProjectTarget } from "@/lib/activity/base-query";
import {
  getLinkedIssuesMap,
  getLinkedPullRequestsMap,
} from "@/lib/activity/cache";
import {
  getProjectFieldOverrides,
  type ProjectFieldOverrides,
} from "@/lib/activity/project-field-store";
import { getActivityStatusHistory } from "@/lib/activity/status-store";
import {
  extractProjectStatusEntries,
  ISSUE_PROJECT_STATUS_LOCKED,
  mapIssueProjectStatus,
  matchProject,
  resolveIssueStatusInfo,
  resolveWorkTimestamps,
} from "@/lib/activity/status-utils";
import type {
  ActivityIssueType,
  ActivityLabel,
  ActivityLinkedIssue,
  ActivityLinkedPullRequest,
  ActivityMilestone,
  IssueProjectStatus,
} from "@/lib/activity/types";
import {
  differenceInBusinessDays,
  differenceInBusinessDaysOrNull,
  loadCombinedHolidaySet,
} from "@/lib/dashboard/business-days";
import { differenceInBusinessDaysInTimeZone } from "@/lib/dashboard/business-days-timezone";
import { createPersonalHolidaySetLoader } from "@/lib/dashboard/personal-holidays";
import {
  buildMentionClassificationKey,
  fetchMentionClassifications,
  type MentionClassificationRecord,
  UNANSWERED_MENTION_PROMPT_VERSION,
} from "@/lib/dashboard/unanswered-mention-classifications";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import {
  getSyncConfig,
  getUserPreferencesByIds,
  getUserProfiles,
  listUserPersonalHolidaysByIds,
  type UserProfile,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export type UserReference = {
  id: string;
  login: string | null;
  name: string | null;
};

export type RepositoryReference = {
  id: string;
  name: string | null;
  nameWithOwner: string | null;
};

export type PullRequestReference = {
  id: string;
  number: number;
  title: string | null;
  url: string | null;
  repository: RepositoryReference | null;
  author: UserReference | null;
  reviewers: UserReference[];
  linkedIssues: ActivityLinkedIssue[];
};

export type PullRequestAttentionItem = PullRequestReference & {
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays?: number;
  waitingDays?: number;
  assignees?: UserReference[];
};

export type ReviewRequestAttentionItem = {
  id: string;
  requestedAt: string;
  waitingDays: number;
  reviewer: UserReference | null;
  pullRequest: PullRequestReference;
  pullRequestAgeDays?: number;
  pullRequestInactivityDays?: number | null;
  pullRequestUpdatedAt?: string | null;
};

export type IssueReference = {
  id: string;
  number: number;
  title: string | null;
  url: string | null;
  repository: RepositoryReference | null;
  repositoryMaintainers: UserReference[];
  author: UserReference | null;
  assignees: UserReference[];
  linkedPullRequests: ActivityLinkedPullRequest[];
  labels: ActivityLabel[];
  issueType: ActivityIssueType | null;
  milestone: ActivityMilestone | null;
};

export type IssueAttentionItem = IssueReference & {
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays?: number | null;
  startedAt?: string | null;
  inProgressAgeDays?: number;
  issueProjectStatus?: IssueProjectStatus | null;
  issueProjectStatusSource?: "todo_project" | "activity" | "none";
  issueProjectStatusLocked?: boolean;
  issueTodoProjectStatus?: IssueProjectStatus | null;
  issueTodoProjectPriority?: string | null;
  issueTodoProjectWeight?: string | null;
  issueTodoProjectInitiationOptions?: string | null;
  issueTodoProjectStartDate?: string | null;
};

export function normalizeOrganizationHolidayCodes(
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

export type MentionAttentionItem = {
  commentId: string;
  url: string | null;
  mentionedAt: string;
  waitingDays: number;
  author: UserReference | null;
  target: UserReference | null;
  container: {
    type: "issue" | "pull_request" | "discussion";
    id: string;
    number: number | null;
    title: string | null;
    url: string | null;
    repository: RepositoryReference | null;
  };
  commentExcerpt: string | null;
  classification: MentionClassificationView | null;
  issueProjectStatus?: IssueProjectStatus | null;
  issueProjectStatusSource?: "todo_project" | "activity" | "none";
  issueProjectStatusLocked?: boolean;
  issueTodoProjectStatus?: IssueProjectStatus | null;
  issueTodoProjectPriority?: string | null;
  issueTodoProjectWeight?: string | null;
  issueTodoProjectInitiationOptions?: string | null;
  issueTodoProjectStartDate?: string | null;
};

export type AttentionInsights = {
  generatedAt: string;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  reviewerUnassignedPrs: PullRequestAttentionItem[];
  reviewStalledPrs: PullRequestAttentionItem[];
  mergeDelayedPrs: PullRequestAttentionItem[];
  stuckReviewRequests: ReviewRequestAttentionItem[];
  backlogIssues: IssueAttentionItem[];
  stalledInProgressIssues: IssueAttentionItem[];
  unansweredMentions: MentionAttentionItem[];
  organizationMaintainers?: UserReference[];
  repositoryMaintainersByRepository?: Record<string, UserReference[]>;
};

type Maybe<T> = T | null | undefined;

type Dataset<T> = {
  items: T[];
  userIds: Set<string>;
};

type MentionClassificationView = {
  requiresResponse: boolean | null;
  manualRequiresResponse: boolean | null;
  manualRequiresResponseAt: string | null;
  manualDecisionIsStale: boolean;
  lastEvaluatedAt: string | null;
};

type ResolvedManualDecision = {
  value: boolean | null;
  isStale: boolean;
  appliedAt: string | null;
};

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

type PullRequestReferenceRaw = {
  id: string;
  number: number;
  title: string | null;
  url: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  repositoryNameWithOwner: string | null;
  authorId: string | null;
  reviewerIds: string[];
  assigneeIds?: string[];
  linkedIssues: ActivityLinkedIssue[];
};

type RawPullRequestItem = PullRequestReferenceRaw & {
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays?: number;
  waitingDays?: number;
};

export type ReviewRequestRawItem = {
  id: string;
  requestedAt: string;
  waitingDays: number;
  reviewerId: string | null;
  pullRequest: PullRequestReferenceRaw;
  pullRequestCreatedAt: string;
  pullRequestUpdatedAt: string | null;
  pullRequestAgeDays: number | null;
  pullRequestInactivityDays: number | null;
};

type IssueReferenceRaw = {
  id: string;
  number: number;
  title: string | null;
  url: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  repositoryNameWithOwner: string | null;
  repositoryMaintainerIds: string[];
  authorId: string | null;
  assigneeIds: string[];
  linkedPullRequests: ActivityLinkedPullRequest[];
  labels: ActivityLabel[];
  issueTypeId: string | null;
  issueTypeName: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  milestoneState: string | null;
  milestoneDueOn: string | Date | null;
  milestoneUrl: string | null;
};

type IssueRawItem = IssueReferenceRaw & {
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays: number | null;
  startedAt: string | null;
  inProgressAgeDays: number | null;
  issueProjectStatus: IssueProjectStatus | null;
  issueProjectStatusSource: "todo_project" | "activity" | "none";
  issueProjectStatusLocked: boolean;
  issueTodoProjectStatus: IssueProjectStatus | null;
  issueTodoProjectPriority: string | null;
  issueTodoProjectWeight: string | null;
  issueTodoProjectInitiationOptions: string | null;
  issueTodoProjectStartDate: string | null;
};

type MentionRawItem = {
  commentId: string;
  url: string | null;
  mentionedAt: string;
  waitingDays: number;
  commentAuthorId: string | null;
  targetUserId: string | null;
  container: {
    type: "issue" | "pull_request" | "discussion";
    id: string;
    number: number | null;
    title: string | null;
    url: string | null;
    repositoryId: string | null;
    repositoryName: string | null;
    repositoryNameWithOwner: string | null;
  };
  commentExcerpt: string | null;
  classification?: MentionClassificationView | null;
  issueProjectStatus?: IssueProjectStatus | null;
  issueProjectStatusSource?: "todo_project" | "activity" | "none";
  issueProjectStatusLocked?: boolean;
  issueTodoProjectStatus?: IssueProjectStatus | null;
  issueTodoProjectPriority?: string | null;
  issueTodoProjectWeight?: string | null;
  issueTodoProjectInitiationOptions?: string | null;
  issueTodoProjectStartDate?: string | null;
};

export type MentionDatasetItem = MentionRawItem & {
  commentBody: string | null;
  commentBodyHash: string;
  mentionedLogin: string | null;
  issueProjectStatus: IssueProjectStatus | null;
  issueProjectStatusSource: "todo_project" | "activity" | "none";
  issueProjectStatusLocked: boolean;
  issueTodoProjectStatus: IssueProjectStatus | null;
  issueTodoProjectPriority: string | null;
  issueTodoProjectWeight: string | null;
  issueTodoProjectInitiationOptions: string | null;
  issueTodoProjectStartDate: string | null;
};

type PullRequestRow = {
  id: string;
  number: number;
  title: string | null;
  repository_id: string;
  author_id: string | null;
  github_created_at: string;
  github_updated_at: string | null;
  url: string | null;
  repository_name: string | null;
  repository_name_with_owner: string | null;
};

type PullRequestRowWithRaw = PullRequestRow & {
  raw_data: unknown;
};

type ReviewRequestRow = {
  id: string;
  pull_request_id: string;
  reviewer_id: string | null;
  requested_at: string;
  pr_number: number;
  pr_title: string | null;
  pr_url: string | null;
  pr_repository_id: string;
  pr_author_id: string | null;
  repository_name: string | null;
  repository_name_with_owner: string | null;
  pr_reviewers: string[] | null;
  pr_created_at: string;
  pr_updated_at: string | null;
};

type ReviewerRow = {
  pull_request_id: string;
  requested_reviewers: string[] | null;
  review_authors: string[] | null;
};

type IssueRow = {
  id: string;
  number: number;
  title: string | null;
  repository_id: string | null;
  author_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  state: string | null;
  url: string | null;
  raw_data: unknown;
  repository_name: string | null;
  repository_name_with_owner: string | null;
  label_keys: string[] | null;
  label_names: string[] | null;
  issue_type_id: string | null;
  issue_type_name: string | null;
  milestone_id: string | null;
  milestone_title: string | null;
  milestone_state: string | null;
  milestone_due_on: string | Date | null;
  milestone_url: string | null;
};

async function fetchLinkedPullRequestsForIssues(
  issueIds: readonly string[],
): Promise<Map<string, ActivityLinkedPullRequest[]>> {
  return issueIds.length
    ? getLinkedPullRequestsMap(issueIds)
    : new Map<string, ActivityLinkedPullRequest[]>();
}

async function fetchLinkedIssuesForPullRequests(
  pullRequestIds: readonly string[],
): Promise<Map<string, ActivityLinkedIssue[]>> {
  return pullRequestIds.length
    ? getLinkedIssuesMap(pullRequestIds)
    : new Map<string, ActivityLinkedIssue[]>();
}

type MentionRow = {
  comment_id: string;
  comment_url: string | null;
  mentioned_at: string;
  comment_body: string | null;
  comment_author_id: string | null;
  mentioned_user_id: string | null;
  mentioned_login: string | null;
  pr_id: string | null;
  pr_number: number | null;
  pr_title: string | null;
  pr_url: string | null;
  pr_repository_id: string | null;
  issue_id: string | null;
  issue_number: number | null;
  issue_title: string | null;
  issue_url: string | null;
  issue_type: "issue" | "discussion" | null;
  repository_id: string | null;
  repository_name: string | null;
  repository_name_with_owner: string | null;
  issue_data: unknown;
};

type IssueRaw = {
  projectStatusHistory?: unknown;
  projectItems?: unknown;
  assignees?: { nodes?: unknown[] } | null;
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

type IssueProjectSnapshot = {
  projectStatus: IssueProjectStatus | null;
  projectStatusSource: "todo_project" | "activity" | "none";
  projectStatusLocked: boolean;
  todoStatus: IssueProjectStatus | null;
  priority: string | null;
  weight: string | null;
  initiationOptions: string | null;
  startDate: string | null;
};

const PR_FOLLOW_UP_BUSINESS_DAYS = 2;
const STUCK_REVIEW_BUSINESS_DAYS = 2;
const BACKLOG_ISSUE_BUSINESS_DAYS = 40;
const STALLED_IN_PROGRESS_BUSINESS_DAYS = 20;
const UNANSWERED_MENTION_BUSINESS_DAYS = 2;
const OCTOAIDE_LOGINS = ["octoaide"];

function differenceInDays(
  value: Maybe<string>,
  now: Date,
  holidays: ReadonlySet<string>,
) {
  return differenceInBusinessDays(value ?? null, now, holidays);
}

function differenceInDaysOrNull(
  value: Maybe<string>,
  now: Date,
  holidays: ReadonlySet<string>,
) {
  return differenceInBusinessDaysOrNull(value ?? null, now, holidays);
}

async function fetchUserIdsByLogins(
  logins: readonly string[],
): Promise<string[]> {
  const normalized = Array.from(
    new Set(
      logins
        .map((login) => login?.trim().toLowerCase() ?? "")
        .filter((login): login is string => login.length > 0),
    ),
  );
  if (!normalized.length) {
    return [];
  }

  const result = await query<{ id: string }>(
    `SELECT id
       FROM users
      WHERE LOWER(login) = ANY($1::text[])`,
    [normalized],
  );

  const ids = new Set<string>();
  for (const row of result.rows) {
    if (row.id) {
      ids.add(row.id);
    }
  }

  return Array.from(ids);
}

function toUserReference(
  profile: UserProfile | undefined,
): UserReference | null {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    login: profile.login,
    name: profile.name,
  };
}

function buildRepositoryReference(
  id: string | null,
  name: string | null,
  nameWithOwner: string | null,
): RepositoryReference | null {
  if (!id) {
    return null;
  }

  return {
    id,
    name,
    nameWithOwner,
  };
}

function addUserId(target: Set<string>, id: Maybe<string>) {
  if (id) {
    target.add(id);
  }
}

function coerceStringArray(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function buildIssueLabels({
  labelKeys,
  labelNames,
  repositoryId,
  repositoryNameWithOwner,
}: {
  labelKeys: string[] | null;
  labelNames: string[] | null;
  repositoryId: string | null;
  repositoryNameWithOwner: string | null;
}): ActivityLabel[] {
  const keys = coerceStringArray(labelKeys);
  const names = coerceStringArray(labelNames);
  const repoId = repositoryId ?? "";
  return keys.map((key, index) => ({
    key,
    name: names[index] ?? key.split(":").pop() ?? key,
    repositoryId: repoId,
    repositoryNameWithOwner: repositoryNameWithOwner ?? null,
  }));
}

function toIsoDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed.length) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
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

    const fieldRecord =
      record.field && typeof record.field === "object"
        ? (record.field as Record<string, unknown>)
        : null;
    const valueRecord =
      record.value && typeof record.value === "object"
        ? (record.value as Record<string, unknown>)
        : null;

    if (fieldRecord?.name === "Priority") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(priorityAggregate, info);
    } else if (fieldRecord?.name === "Weight") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(weightAggregate, info);
    } else if (fieldRecord?.name === "Initiation") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(initiationAggregate, info);
    } else if (fieldRecord?.name === "Start date") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(startAggregate, info);
    }
  });

  result.priority = priorityAggregate.value;
  result.priorityUpdatedAt = priorityAggregate.updatedAt;
  result.weight = weightAggregate.value;
  result.weightUpdatedAt = weightAggregate.updatedAt;
  result.initiationOptions = initiationAggregate.value;
  result.initiationOptionsUpdatedAt = initiationAggregate.updatedAt;
  result.startDate = startAggregate.dateValue ?? startAggregate.value;
  result.startDateUpdatedAt = startAggregate.updatedAt;

  // Weight field may live at the root connection nodes as direct values.
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

    const fieldRecord =
      record.field && typeof record.field === "object"
        ? (record.field as Record<string, unknown>)
        : null;
    const valueRecord =
      record.value && typeof record.value === "object"
        ? (record.value as Record<string, unknown>)
        : null;

    if (fieldRecord?.name === "Weight") {
      const info = extractProjectFieldValueInfo(valueRecord, []);
      result.weight = info.value;
      result.weightUpdatedAt = info.updatedAt;
    }
  });

  return result;
}

function normalizePriorityOverride(value: string | null | undefined) {
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

function normalizeWeightOverride(value: string | null | undefined) {
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

type ProjectFieldOverrideTarget = {
  issueProjectStatusLocked?: boolean | null;
  issueTodoProjectPriority?: string | null;
  issueTodoProjectWeight?: string | null;
  issueTodoProjectInitiationOptions?: string | null;
  issueTodoProjectStartDate?: string | null;
};

function applyProjectFieldOverridesToTarget(
  target: ProjectFieldOverrideTarget,
  overrides: ProjectFieldOverrides | undefined,
) {
  if (!overrides) {
    return;
  }
  if (target.issueProjectStatusLocked) {
    return;
  }
  const normalizedPriority = normalizePriorityOverride(overrides.priority);
  if (normalizedPriority) {
    target.issueTodoProjectPriority = normalizedPriority;
  }
  const normalizedWeight = normalizeWeightOverride(overrides.weight);
  if (normalizedWeight) {
    target.issueTodoProjectWeight = normalizedWeight;
  }
  if (overrides.initiationOptions) {
    target.issueTodoProjectInitiationOptions = overrides.initiationOptions;
  }
  if (overrides.startDate) {
    target.issueTodoProjectStartDate = overrides.startDate;
  }
}

function resolveIssueProjectSnapshot(
  raw: IssueRaw | null,
  targetProject: string | null,
): IssueProjectSnapshot {
  const entries = extractProjectStatusEntries(raw, targetProject);
  const latestEntry = entries.length ? entries[entries.length - 1] : null;
  const todoStatus = latestEntry
    ? mapIssueProjectStatus(latestEntry.status)
    : "no_status";
  const fields = extractTodoProjectFieldValues(raw, targetProject);
  const hasStatus = todoStatus !== "no_status";
  const projectStatus = hasStatus ? todoStatus : null;
  const projectStatusSource: "todo_project" | "activity" | "none" = hasStatus
    ? "todo_project"
    : "none";
  const projectStatusLocked = hasStatus
    ? ISSUE_PROJECT_STATUS_LOCKED.has(todoStatus)
    : false;

  return {
    projectStatus,
    projectStatusSource,
    projectStatusLocked,
    todoStatus: hasStatus ? todoStatus : null,
    priority: fields.priority,
    weight: fields.weight,
    initiationOptions: fields.initiationOptions,
    startDate: fields.startDate,
  };
}

function extractAssigneeIds(raw: IssueRaw | null) {
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

function extractCommentExcerpt(body: string | null) {
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

function computeCommentBodyHash(body: string | null | undefined) {
  return createHash("sha256")
    .update(body ?? "", "utf8")
    .digest("hex");
}

async function fetchReviewerMap(
  prIds: string[],
  excludedUserIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  if (!prIds.length) {
    return new Map();
  }

  const result = await query<ReviewerRow>(
    `SELECT
       pull_request_id,
       ARRAY_AGG(DISTINCT reviewer_id) FILTER (WHERE source = 'request') AS requested_reviewers,
       ARRAY_AGG(DISTINCT reviewer_id) FILTER (WHERE source = 'review') AS review_authors
     FROM (
       SELECT rr.pull_request_id, rr.reviewer_id, 'request'::text AS source
       FROM review_requests rr
       WHERE rr.pull_request_id = ANY($1::text[])
         AND rr.reviewer_id IS NOT NULL
         AND rr.removed_at IS NULL
         AND NOT (rr.reviewer_id = ANY($2::text[]))
       UNION ALL
       SELECT rv.pull_request_id, rv.author_id, 'review'::text AS source
       FROM reviews rv
       WHERE rv.pull_request_id = ANY($1::text[])
         AND rv.author_id IS NOT NULL
         AND NOT (rv.author_id = ANY($2::text[]))
     ) sources
     GROUP BY pull_request_id`,
    [prIds, excludedUserIds],
  );

  const map = new Map<string, Set<string>>();
  result.rows.forEach((row) => {
    const set = new Set<string>();
    (row.requested_reviewers ?? []).forEach((id) => {
      if (id) {
        set.add(id);
      }
    });
    (row.review_authors ?? []).forEach((id) => {
      if (id) {
        set.add(id);
      }
    });
    map.set(row.pull_request_id, set);
  });

  return map;
}

async function fetchRepositoryMaintainersByRepository(
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

function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format();
    return trimmed;
  } catch {
    return null;
  }
}

async function fetchReviewUnassignedPullRequests(
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

type ReviewerRequestedAtRow = {
  pull_request_id: string;
  reviewer_id: string | null;
  requested_at: string | null;
};

type ReviewerLastActivityRow = {
  pull_request_id: string;
  author_id: string | null;
  last_activity_at: string | null;
};

async function fetchReviewStalledPullRequests(
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

type MergeDelayedPullRequestRow = PullRequestRowWithRaw & {
  approved_at: string | null;
};

async function fetchMergeDelayedPullRequests(
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

export async function fetchStuckReviewRequests(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
): Promise<Dataset<ReviewRequestRawItem>> {
  const result = await query<ReviewRequestRow>(
    `WITH base AS (
       SELECT
         rr.id,
         rr.pull_request_id,
         rr.reviewer_id,
         rr.requested_at,
         pr.number AS pr_number,
         pr.title AS pr_title,
         pr.data->>'url' AS pr_url,
         pr.github_created_at AS pr_created_at,
         pr.github_updated_at AS pr_updated_at,
         pr.repository_id AS pr_repository_id,
         pr.author_id AS pr_author_id,
         repo.name AS repository_name,
         repo.name_with_owner AS repository_name_with_owner
       FROM review_requests rr
       JOIN pull_requests pr ON pr.id = rr.pull_request_id
       JOIN repositories repo ON repo.id = pr.repository_id
       WHERE rr.reviewer_id IS NOT NULL
         AND rr.removed_at IS NULL
         AND rr.requested_at <= $3::timestamptz - INTERVAL '2 days'
         AND pr.github_closed_at IS NULL
         AND COALESCE(pr.data->>'reviewDecision', '') <> 'APPROVED'
         AND NOT (pr.repository_id = ANY($1::text[]))
         AND (pr.author_id IS NULL OR NOT (pr.author_id = ANY($2::text[])))
         AND NOT (rr.reviewer_id = ANY($2::text[]))
         AND NOT EXISTS (
           SELECT 1
           FROM reviews r
           WHERE r.pull_request_id = rr.pull_request_id
             AND r.author_id = rr.reviewer_id
             AND r.github_submitted_at IS NOT NULL
             AND r.github_submitted_at >= rr.requested_at
         )
         AND NOT EXISTS (
           SELECT 1
           FROM comments c
           WHERE c.pull_request_id = rr.pull_request_id
             AND c.author_id = rr.reviewer_id
             AND c.github_created_at >= rr.requested_at
         )
         AND NOT EXISTS (
           SELECT 1
           FROM reactions reac
           LEFT JOIN comments comment ON comment.id = reac.subject_id
           LEFT JOIN reviews review ON review.id = reac.subject_id
            WHERE reac.user_id = rr.reviewer_id
              AND (
                (LOWER(reac.subject_type) LIKE 'pullrequest%' AND reac.subject_id = rr.pull_request_id) OR
                (comment.pull_request_id = rr.pull_request_id) OR
                (review.pull_request_id = rr.pull_request_id)
              )
             AND COALESCE(reac.github_created_at, NOW()) >= rr.requested_at
         )
     )
     SELECT
       base.id,
       base.pull_request_id,
       base.reviewer_id,
       base.requested_at,
       base.pr_number,
       base.pr_title,
       base.pr_url,
       base.pr_created_at,
       base.pr_updated_at,
       base.pr_repository_id,
       base.pr_author_id,
       base.repository_name,
       base.repository_name_with_owner,
       ARRAY(SELECT DISTINCT reviewer_id
             FROM review_requests
             WHERE pull_request_id = base.pull_request_id
               AND reviewer_id IS NOT NULL
               AND removed_at IS NULL
               AND NOT (reviewer_id = ANY($2::text[])))
         || ARRAY(SELECT DISTINCT author_id
                 FROM reviews
                 WHERE pull_request_id = base.pull_request_id
                   AND author_id IS NOT NULL
                   AND NOT (author_id = ANY($2::text[])))
         AS pr_reviewers
     FROM base
     ORDER BY base.requested_at ASC`,
    [excludedRepositoryIds, excludedUserIds, now],
  );

  const userIds = new Set<string>();
  const prIds = result.rows.map((row) => row.pull_request_id);
  const [prReviewerMap, linkedIssuesMap] = await Promise.all([
    fetchReviewerMap(prIds, excludedUserIds),
    fetchLinkedIssuesForPullRequests(prIds),
  ]);

  const reviewerIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.reviewer_id)
        .filter((id): id is string => Boolean(id)),
    ),
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

  const items: ReviewRequestRawItem[] = [];

  for (const row of result.rows) {
    const reviewerHolidays = await getPersonalHolidaySet(row.reviewer_id);
    const waitingDays = differenceInDays(
      row.requested_at,
      now,
      reviewerHolidays,
    );
    if (waitingDays < STUCK_REVIEW_BUSINESS_DAYS) {
      continue;
    }

    const reviewerSet =
      prReviewerMap.get(row.pull_request_id) ?? new Set<string>();
    const combinedReviewers = new Set<string>(reviewerSet);
    (row.pr_reviewers ?? []).forEach((id) => {
      if (id) {
        combinedReviewers.add(id);
      }
    });
    if (row.reviewer_id) {
      combinedReviewers.add(row.reviewer_id);
    }

    const reviewerIds = Array.from(combinedReviewers);
    for (const id of reviewerIds) {
      addUserId(userIds, id);
    }
    addUserId(userIds, row.pr_author_id);
    addUserId(userIds, row.reviewer_id);

    const pullRequestAgeDays = differenceInDaysOrNull(
      row.pr_created_at,
      now,
      organizationHolidaySet,
    );
    const pullRequestInactivityDays = differenceInDaysOrNull(
      row.pr_updated_at,
      now,
      organizationHolidaySet,
    );

    items.push({
      id: row.id,
      requestedAt: row.requested_at,
      waitingDays,
      reviewerId: row.reviewer_id,
      pullRequest: {
        id: row.pull_request_id,
        number: row.pr_number,
        title: row.pr_title,
        url: row.pr_url,
        repositoryId: row.pr_repository_id,
        repositoryName: row.repository_name,
        repositoryNameWithOwner: row.repository_name_with_owner,
        authorId: row.pr_author_id,
        reviewerIds,
        linkedIssues: linkedIssuesMap.get(row.pull_request_id) ?? [],
      },
      pullRequestCreatedAt: row.pr_created_at,
      pullRequestAgeDays,
      pullRequestInactivityDays,
      pullRequestUpdatedAt: row.pr_updated_at,
    });
  }

  return { items, userIds };
}

async function fetchOrganizationMaintainerIds(): Promise<string[]> {
  const result = await query<{ user_id: string | null }>(
    `SELECT DISTINCT user_id
       FROM repository_maintainers
      WHERE user_id IS NOT NULL`,
  );

  return result.rows
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
}

async function fetchIssueInsights(
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

  type MentionIssueSnapshotRow = {
    id: string;
    issue_project_status: string | null;
    issue_project_status_source: string | null;
    issue_project_status_locked: boolean | null;
    issue_todo_project_status: string | null;
    issue_todo_project_priority: string | null;
    issue_todo_project_weight: string | null;
    issue_todo_project_initiation_options: string | null;
    issue_todo_project_start_date: string | null;
  };

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
  let mentionProjectOverrides: Map<string, ProjectFieldOverrides>;
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

    const containerType: MentionAttentionItem["container"]["type"] = row.pr_id
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

      const overrideTarget: ProjectFieldOverrideTarget = {
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

async function fetchUnansweredMentions(
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

function toPullRequestReference(
  raw: PullRequestReferenceRaw,
  users: Map<string, UserReference>,
): PullRequestReference {
  const uniqueReviewerIds = Array.from(new Set(raw.reviewerIds));
  const reviewers = uniqueReviewerIds
    .map((id) => users.get(id))
    .filter((value): value is UserReference => Boolean(value));

  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    repository: buildRepositoryReference(
      raw.repositoryId,
      raw.repositoryName,
      raw.repositoryNameWithOwner,
    ),
    author: raw.authorId ? (users.get(raw.authorId) ?? null) : null,
    reviewers,
    linkedIssues: raw.linkedIssues ?? [],
  } satisfies PullRequestReference;
}

function toIssueReference(
  raw: IssueReferenceRaw,
  users: Map<string, UserReference>,
): IssueReference {
  const assignees = raw.assigneeIds
    .map((id) => users.get(id))
    .filter((value): value is UserReference => Boolean(value));
  const repositoryMaintainers = raw.repositoryMaintainerIds
    .map((id) => users.get(id))
    .filter((value): value is UserReference => Boolean(value));
  const issueTypeId = raw.issueTypeId?.trim();
  const milestoneId = raw.milestoneId?.trim();
  const issueType: ActivityIssueType | null = issueTypeId?.length
    ? {
        id: issueTypeId,
        name: raw.issueTypeName ?? null,
      }
    : null;
  const milestone: ActivityMilestone | null = milestoneId?.length
    ? {
        id: milestoneId,
        title: raw.milestoneTitle ?? null,
        state: raw.milestoneState ?? null,
        dueOn: toIsoDate(raw.milestoneDueOn),
        url: raw.milestoneUrl ?? null,
      }
    : null;

  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    repository: buildRepositoryReference(
      raw.repositoryId,
      raw.repositoryName,
      raw.repositoryNameWithOwner,
    ),
    repositoryMaintainers,
    author: raw.authorId ? (users.get(raw.authorId) ?? null) : null,
    assignees,
    linkedPullRequests: raw.linkedPullRequests ?? [],
    labels: raw.labels ?? [],
    issueType,
    milestone,
  } satisfies IssueReference;
}

export async function getAttentionInsights(options?: {
  userId?: string | null;
  useMentionClassifier?: boolean;
  reviewerUnassignedPrDays?: number;
  reviewStalledPrDays?: number;
  mergeDelayedPrDays?: number;
}): Promise<AttentionInsights> {
  await ensureSchema();

  const [config, userTimeSettings] = await Promise.all([
    getSyncConfig(),
    readUserTimeSettings(options?.userId ?? null),
  ]);
  const organizationHolidayCodes = normalizeOrganizationHolidayCodes(config);
  const organizationHolidaySet = await loadCombinedHolidaySet(
    organizationHolidayCodes,
  );
  const excludedUserIds = new Set<string>(
    Array.isArray(config?.excluded_user_ids)
      ? (config?.excluded_user_ids as string[]).filter(
          (id) => typeof id === "string" && id.trim().length > 0,
        )
      : [],
  );
  const excludedRepositoryIds = new Set<string>(
    Array.isArray(config?.excluded_repository_ids)
      ? (config?.excluded_repository_ids as string[]).filter(
          (id) => typeof id === "string" && id.trim().length > 0,
        )
      : [],
  );
  const timezone = userTimeSettings.timezone;
  const dateTimeFormat = userTimeSettings.dateTimeFormat;
  const excludedUsersArray = Array.from(excludedUserIds);
  const excludedReposArray = Array.from(excludedRepositoryIds);
  const now = new Date();
  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);
  const reviewerUnassignedPrDays = Math.max(
    1,
    options?.reviewerUnassignedPrDays ?? 2,
  );
  const reviewStalledPrDays = Math.max(1, options?.reviewStalledPrDays ?? 2);
  const mergeDelayedPrDays = Math.max(1, options?.mergeDelayedPrDays ?? 2);

  const [
    reviewerUnassigned,
    reviewStalled,
    mergeDelayed,
    stuckReviews,
    issueInsights,
    mentions,
    organizationMaintainerIds,
  ] = await Promise.all([
    fetchReviewUnassignedPullRequests(
      excludedReposArray,
      excludedUsersArray,
      reviewerUnassignedPrDays,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchReviewStalledPullRequests(
      excludedReposArray,
      excludedUsersArray,
      reviewStalledPrDays,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchMergeDelayedPullRequests(
      excludedReposArray,
      excludedUsersArray,
      mergeDelayedPrDays,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchStuckReviewRequests(
      excludedReposArray,
      excludedUsersArray,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchIssueInsights(
      excludedReposArray,
      excludedUsersArray,
      targetProject,
      now,
      organizationHolidaySet,
    ),
    fetchUnansweredMentions(
      excludedReposArray,
      excludedUsersArray,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
      targetProject,
      {
        useClassifier: options?.useMentionClassifier ?? true,
      },
    ),
    fetchOrganizationMaintainerIds(),
  ]);

  const reviewStalledExcludedPullRequestIds = new Set<string>();
  reviewerUnassigned.items.forEach((item) => {
    reviewStalledExcludedPullRequestIds.add(item.id);
  });
  mergeDelayed.items.forEach((item) => {
    reviewStalledExcludedPullRequestIds.add(item.id);
  });
  stuckReviews.items.forEach((item) => {
    reviewStalledExcludedPullRequestIds.add(item.pullRequest.id);
  });
  if (reviewStalledExcludedPullRequestIds.size > 0) {
    reviewStalled.items = reviewStalled.items.filter(
      (item) => !reviewStalledExcludedPullRequestIds.has(item.id),
    );
    reviewStalled.userIds = new Set<string>();
    reviewStalled.items.forEach((item) => {
      if (item.authorId) {
        reviewStalled.userIds.add(item.authorId);
      }
      item.reviewerIds.forEach((id) => {
        reviewStalled.userIds.add(id);
      });
    });
  }

  const userIdSet = new Set<string>();
  reviewerUnassigned.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  reviewStalled.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  mergeDelayed.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  stuckReviews.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  issueInsights.backlog.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  issueInsights.stalled.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  mentions.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  organizationMaintainerIds.forEach((id) => {
    userIdSet.add(id);
  });

  const userProfiles = userIdSet.size
    ? await getUserProfiles(Array.from(userIdSet))
    : [];
  const userMap = new Map<string, UserReference>();
  userProfiles.forEach((profile) => {
    const reference = toUserReference(profile);
    if (reference) {
      userMap.set(reference.id, reference);
    }
  });
  const organizationMaintainers = organizationMaintainerIds
    .map((id) => userMap.get(id))
    .filter((user): user is UserReference => Boolean(user));
  const allRepositoryIds = new Set<string>();
  issueInsights.repositoryMaintainersByRepository.forEach((_ids, repoId) => {
    allRepositoryIds.add(repoId);
  });
  reviewerUnassigned.items.forEach((item) => {
    if (item.repositoryId) {
      allRepositoryIds.add(item.repositoryId);
    }
  });
  reviewStalled.items.forEach((item) => {
    if (item.repositoryId) {
      allRepositoryIds.add(item.repositoryId);
    }
  });
  mergeDelayed.items.forEach((item) => {
    if (item.repositoryId) {
      allRepositoryIds.add(item.repositoryId);
    }
  });
  stuckReviews.items.forEach((item) => {
    if (item.pullRequest.repositoryId) {
      allRepositoryIds.add(item.pullRequest.repositoryId);
    }
  });
  const allMaintainersByRepository =
    await fetchRepositoryMaintainersByRepository(Array.from(allRepositoryIds));
  const repositoryMaintainersByRepository: Record<string, UserReference[]> = {};
  allMaintainersByRepository.forEach((ids, repoId) => {
    const entries = ids
      .map((id) => userMap.get(id))
      .filter((user): user is UserReference => Boolean(user));
    if (entries.length) {
      repositoryMaintainersByRepository[repoId] = entries;
    }
  });

  const reviewerUnassignedPrs =
    reviewerUnassigned.items.map<PullRequestAttentionItem>((item) => ({
      ...toPullRequestReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays,
      waitingDays: item.waitingDays,
    }));

  const reviewStalledPrs = reviewStalled.items.map<PullRequestAttentionItem>(
    (item) => ({
      ...toPullRequestReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays,
      waitingDays: item.waitingDays,
    }),
  );

  const mergeDelayedPrs = mergeDelayed.items.map<PullRequestAttentionItem>(
    (item) => ({
      ...toPullRequestReference(item, userMap),
      assignees: (item.assigneeIds ?? [])
        .map((id) => userMap.get(id))
        .filter((user): user is UserReference => Boolean(user)),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays,
      waitingDays: item.waitingDays,
    }),
  );

  const stuckReviewRequests =
    stuckReviews.items.map<ReviewRequestAttentionItem>((item) => ({
      id: item.id,
      requestedAt: item.requestedAt,
      waitingDays: item.waitingDays,
      reviewer: item.reviewerId ? (userMap.get(item.reviewerId) ?? null) : null,
      pullRequest: toPullRequestReference(item.pullRequest, userMap),
      pullRequestAgeDays: item.pullRequestAgeDays ?? undefined,
      pullRequestInactivityDays: item.pullRequestInactivityDays,
      pullRequestUpdatedAt: item.pullRequestUpdatedAt,
    }));

  const backlogIssues = issueInsights.backlog.items.map<IssueAttentionItem>(
    (item) => ({
      ...toIssueReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays ?? undefined,
      startedAt: item.startedAt,
      inProgressAgeDays: item.inProgressAgeDays ?? undefined,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
    }),
  );

  const stalledInProgressIssues =
    issueInsights.stalled.items.map<IssueAttentionItem>((item) => ({
      ...toIssueReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays ?? undefined,
      startedAt: item.startedAt,
      inProgressAgeDays: item.inProgressAgeDays ?? undefined,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
    }));

  const unansweredMentions = mentions.items.map<MentionAttentionItem>(
    (item) => ({
      commentId: item.commentId,
      url: item.url,
      mentionedAt: item.mentionedAt,
      waitingDays: item.waitingDays,
      author: item.commentAuthorId
        ? (userMap.get(item.commentAuthorId) ?? null)
        : null,
      target: item.targetUserId
        ? (userMap.get(item.targetUserId) ?? null)
        : null,
      container: {
        type: item.container.type,
        id: item.container.id,
        number: item.container.number,
        title: item.container.title,
        url: item.container.url,
        repository: buildRepositoryReference(
          item.container.repositoryId,
          item.container.repositoryName,
          item.container.repositoryNameWithOwner,
        ),
      },
      commentExcerpt: item.commentExcerpt,
      classification: item.classification
        ? {
            requiresResponse: item.classification.requiresResponse,
            manualRequiresResponse:
              item.classification.manualRequiresResponse ?? null,
            manualRequiresResponseAt:
              item.classification.manualRequiresResponseAt ?? null,
            manualDecisionIsStale:
              item.classification.manualDecisionIsStale ?? false,
            lastEvaluatedAt: item.classification.lastEvaluatedAt ?? null,
          }
        : null,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
    }),
  );

  return {
    generatedAt: now.toISOString(),
    timezone,
    dateTimeFormat,
    reviewerUnassignedPrs,
    reviewStalledPrs,
    mergeDelayedPrs,
    stuckReviewRequests,
    backlogIssues,
    stalledInProgressIssues,
    unansweredMentions,
    organizationMaintainers,
    repositoryMaintainersByRepository,
  } satisfies AttentionInsights;
}
