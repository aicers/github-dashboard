import {
  getLinkedIssuesMap,
  getLinkedPullRequestsMap,
} from "@/lib/activity/cache";
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
} from "@/lib/dashboard/business-days";

export { normalizeOrganizationHolidayCodes } from "@/lib/dashboard/holiday-utils";

import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { query } from "@/lib/db/client";
import type { UserProfile } from "@/lib/db/operations";
import type { HolidayCalendarCode } from "@/lib/holidays/constants";

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

export type Maybe<T> = T | null | undefined;

export type Dataset<T> = {
  items: T[];
  userIds: Set<string>;
};

export type MentionClassificationView = {
  requiresResponse: boolean | null;
  manualRequiresResponse: boolean | null;
  manualRequiresResponseAt: string | null;
  manualDecisionIsStale: boolean;
  lastEvaluatedAt: string | null;
};

export type ResolvedManualDecision = {
  value: boolean | null;
  isStale: boolean;
  appliedAt: string | null;
};

export type PullRequestReferenceRaw = {
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

export type RawPullRequestItem = PullRequestReferenceRaw & {
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

export type IssueReferenceRaw = {
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

export type IssueRawItem = IssueReferenceRaw & {
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

export type MentionRawItem = {
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

export type PullRequestRow = {
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

export type PullRequestRowWithRaw = PullRequestRow & {
  raw_data: unknown;
};

export type ReviewRequestRow = {
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

export type ReviewerRow = {
  pull_request_id: string;
  requested_reviewers: string[] | null;
  review_authors: string[] | null;
};

export type IssueRow = {
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

export type MentionRow = {
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

export type IssueProjectSnapshot = {
  projectStatus: IssueProjectStatus | null;
  projectStatusSource: "todo_project" | "activity" | "none";
  projectStatusLocked: boolean;
  todoStatus: IssueProjectStatus | null;
  priority: string | null;
  weight: string | null;
  initiationOptions: string | null;
  startDate: string | null;
};

export type ReviewerRequestedAtRow = {
  pull_request_id: string;
  reviewer_id: string | null;
  requested_at: string | null;
};

export type ReviewerLastActivityRow = {
  pull_request_id: string;
  author_id: string | null;
  last_activity_at: string | null;
};

export type MergeDelayedPullRequestRow = PullRequestRowWithRaw & {
  approved_at: string | null;
};

export type MentionIssueSnapshotRow = {
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

export const PR_FOLLOW_UP_BUSINESS_DAYS = 2;
export const STUCK_REVIEW_BUSINESS_DAYS = 2;
export const BACKLOG_ISSUE_BUSINESS_DAYS = 40;
export const STALLED_IN_PROGRESS_BUSINESS_DAYS = 20;
export const UNANSWERED_MENTION_BUSINESS_DAYS = 2;
export const OCTOAIDE_LOGINS = ["octoaide"];

export function differenceInDays(
  value: Maybe<string>,
  now: Date,
  holidays: ReadonlySet<string>,
) {
  return differenceInBusinessDays(value ?? null, now, holidays);
}

export function differenceInDaysOrNull(
  value: Maybe<string>,
  now: Date,
  holidays: ReadonlySet<string>,
) {
  return differenceInBusinessDaysOrNull(value ?? null, now, holidays);
}

export function addUserId(target: Set<string>, id: Maybe<string>) {
  if (id) {
    target.add(id);
  }
}

export function coerceStringArray(
  value: string[] | null | undefined,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function buildIssueLabels({
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

export function normalizeTimeZone(value: unknown): string | null {
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

export function toUserReference(
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

export function buildRepositoryReference(
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

export function toPullRequestReference(
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

export function toIsoDate(value: string | Date | null | undefined) {
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

export function toIssueReference(
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

export async function fetchLinkedPullRequestsForIssues(
  issueIds: readonly string[],
): Promise<Map<string, ActivityLinkedPullRequest[]>> {
  return issueIds.length
    ? getLinkedPullRequestsMap(issueIds)
    : new Map<string, ActivityLinkedPullRequest[]>();
}

export async function fetchLinkedIssuesForPullRequests(
  pullRequestIds: readonly string[],
): Promise<Map<string, ActivityLinkedIssue[]>> {
  return pullRequestIds.length
    ? getLinkedIssuesMap(pullRequestIds)
    : new Map<string, ActivityLinkedIssue[]>();
}

export async function fetchUserIdsByLogins(
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

export async function fetchReviewerMap(
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

// Suppress unused import warning — HolidayCalendarCode is needed transitively
// by sub-modules that import from this file.
export type { HolidayCalendarCode };
