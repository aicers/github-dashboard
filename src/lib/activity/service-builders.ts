import {
  parseIssueRaw,
  parseRawRecord,
  toIso,
  toIsoWithFallback,
} from "@/lib/activity/data-utils";
import type { ProjectFieldOverrides } from "@/lib/activity/project-field-store";
import {
  extractTodoProjectFieldValuesNormalized,
  normalizePriorityText,
  normalizeWeightText,
} from "@/lib/activity/project-field-utils";
import {
  coerceArray,
  dedupeMentionDetails,
  dedupeReviewRequestDetails,
  mapReferencedUser,
  mapUser,
  mapUsers,
  toStatus,
} from "@/lib/activity/service-utils";
import type { ActivityStatusEvent } from "@/lib/activity/status-store";
import {
  resolveIssueStatusInfo,
  resolveWorkTimestamps,
} from "@/lib/activity/status-utils";
import type {
  ActivityAttentionFlags,
  ActivityItem,
  ActivityLabel,
  ActivityLinkedIssue,
  ActivityLinkedPullRequest,
  ActivityStatusFilter,
  ActivityUser,
  IssueProjectStatus,
} from "@/lib/activity/types";
import type {
  MentionAttentionItem,
  ReviewRequestAttentionItem,
} from "@/lib/dashboard/attention";
import {
  differenceInBusinessDays,
  differenceInBusinessDaysOrNull,
} from "@/lib/dashboard/business-days";

export type ActivityRow = {
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

export type AttentionSets = {
  unansweredMentions: Set<string>;
  reviewRequests: Set<string>;
  reviewerUnassignedPullRequests: Set<string>;
  reviewStalledPullRequests: Set<string>;
  mergeDelayedPullRequests: Set<string>;
  backlogIssues: Set<string>;
  stalledIssues: Set<string>;
  reviewRequestDetails: Map<string, ReviewRequestAttentionItem[]>;
  mentionDetails: Map<string, MentionAttentionItem[]>;
};

export function buildLabels(row: ActivityRow): ActivityLabel[] {
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

export function buildAttentionFlags(
  row: ActivityRow,
  sets: AttentionSets,
  status: ActivityStatusFilter,
): ActivityAttentionFlags {
  if (row.item_type === "pull_request") {
    return {
      unansweredMention: sets.unansweredMentions.has(row.id),
      reviewRequestPending: sets.reviewRequests.has(row.id),
      reviewerUnassignedPr:
        status === "open" && sets.reviewerUnassignedPullRequests.has(row.id),
      reviewStalledPr:
        status === "open" && sets.reviewStalledPullRequests.has(row.id),
      mergeDelayedPr:
        status === "open" && sets.mergeDelayedPullRequests.has(row.id),
      backlogIssue: false,
      stalledIssue: false,
    };
  }

  if (row.item_type === "discussion") {
    return {
      unansweredMention: sets.unansweredMentions.has(row.id),
      reviewRequestPending: false,
      reviewerUnassignedPr: false,
      reviewStalledPr: false,
      mergeDelayedPr: false,
      backlogIssue: false,
      stalledIssue: false,
    };
  }

  const backlog = sets.backlogIssues.has(row.id);
  const stalled = sets.stalledIssues.has(row.id);

  return {
    unansweredMention: sets.unansweredMentions.has(row.id),
    reviewRequestPending: false,
    reviewerUnassignedPr: false,
    reviewStalledPr: false,
    mergeDelayedPr: false,
    backlogIssue: backlog,
    stalledIssue: stalled,
  };
}

export function buildActivityItem(
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
    const todoProjectFields = extractTodoProjectFieldValuesNormalized(
      raw,
      targetProject,
    );
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
