import type {
  ActivityAttentionFlags,
  ActivityItem,
  ActivityItemDetail,
  ActivityItemType,
  ActivityListResult,
  ActivityPageInfo,
  ActivityRepository,
  ActivityStatusFilter,
  ActivityThresholds,
  ActivityUser,
  IssueProjectStatus,
} from "@/lib/activity/types";

type ActivityItemOverrides = Partial<ActivityItem>;
type ActivityItemDetailOverrides = Partial<ActivityItemDetail>;
type ActivityRepositoryOverrides = Partial<ActivityRepository>;
type ActivityUserOverrides = Partial<ActivityUser>;
type ActivityPageInfoOverrides = Partial<ActivityPageInfo>;
type ActivityListResultOverrides = Partial<ActivityListResult>;

let activityItemCounter = 0;
let activityUserCounter = 0;
let activityRepoCounter = 0;

const DEFAULT_ATTENTION_FLAGS: ActivityAttentionFlags = {
  unansweredMention: false,
  reviewRequestPending: false,
  staleOpenPr: false,
  idlePr: false,
  backlogIssue: false,
  stalledIssue: false,
};

const DEFAULT_PROJECT_STATUS: IssueProjectStatus = "todo";

export function buildActivityUser(
  overrides: ActivityUserOverrides = {},
): ActivityUser {
  const identifier = overrides.id ?? `user-${++activityUserCounter}`;
  const login = overrides.login ?? identifier;
  return {
    id: identifier,
    login,
    name: overrides.name ?? login,
    avatarUrl: overrides.avatarUrl ?? null,
    ...overrides,
  };
}

export function buildActivityRepository(
  overrides: ActivityRepositoryOverrides = {},
): ActivityRepository {
  const identifier = overrides.id ?? `repo-${++activityRepoCounter}`;
  const name = overrides.name ?? `repo-${activityRepoCounter}`;
  const nameWithOwner =
    overrides.nameWithOwner ?? `owner-${activityRepoCounter}/${name}`;
  return {
    id: identifier,
    name,
    nameWithOwner,
    ...overrides,
  };
}

export function buildActivityItem(
  overrides: ActivityItemOverrides = {},
): ActivityItem {
  const {
    assignees,
    reviewers,
    mentionedUsers,
    commenters,
    reactors,
    repository,
    author,
    attention,
    labels,
    ...rest
  } = overrides;

  const identifier = rest.id ?? `activity-${++activityItemCounter}`;
  const type: ActivityItemType = rest.type ?? "issue";
  const status: ActivityStatusFilter =
    rest.status ?? (type === "pull_request" ? "open" : "open");

  const item: ActivityItem = {
    id: identifier,
    type,
    number: rest.number ?? 101,
    title: rest.title ?? `${type} title ${activityItemCounter}`,
    url: rest.url ?? `https://example.com/${type}/${activityItemCounter}`,
    state: rest.state ?? "OPEN",
    status,
    issueProjectStatus: rest.issueProjectStatus ?? DEFAULT_PROJECT_STATUS,
    issueProjectStatusSource: rest.issueProjectStatusSource ?? "activity",
    issueProjectStatusLocked: rest.issueProjectStatusLocked ?? false,
    issueTodoProjectStatus:
      rest.issueTodoProjectStatus ?? DEFAULT_PROJECT_STATUS,
    issueTodoProjectStatusAt: rest.issueTodoProjectStatusAt ?? null,
    issueTodoProjectPriority: rest.issueTodoProjectPriority ?? null,
    issueTodoProjectPriorityUpdatedAt:
      rest.issueTodoProjectPriorityUpdatedAt ?? null,
    issueTodoProjectWeight: rest.issueTodoProjectWeight ?? null,
    issueTodoProjectWeightUpdatedAt:
      rest.issueTodoProjectWeightUpdatedAt ?? null,
    issueTodoProjectInitiationOptions:
      rest.issueTodoProjectInitiationOptions ?? null,
    issueTodoProjectInitiationOptionsUpdatedAt:
      rest.issueTodoProjectInitiationOptionsUpdatedAt ?? null,
    issueTodoProjectStartDate: rest.issueTodoProjectStartDate ?? null,
    issueTodoProjectStartDateUpdatedAt:
      rest.issueTodoProjectStartDateUpdatedAt ?? null,
    issueActivityStatus: rest.issueActivityStatus ?? DEFAULT_PROJECT_STATUS,
    issueActivityStatusAt: rest.issueActivityStatusAt ?? null,
    linkedPullRequests: rest.linkedPullRequests ?? [],
    linkedIssues: rest.linkedIssues ?? [],
    repository: repository
      ? buildActivityRepository(repository)
      : buildActivityRepository(),
    author: author ? buildActivityUser(author) : buildActivityUser(),
    assignees: assignees
      ? assignees.map((value) => buildActivityUser(value))
      : [],
    reviewers: reviewers
      ? reviewers.map((value) => buildActivityUser(value))
      : [],
    mentionedUsers: mentionedUsers
      ? mentionedUsers.map((value) => buildActivityUser(value))
      : [],
    commenters: commenters
      ? commenters.map((value) => buildActivityUser(value))
      : [],
    reactors: reactors ? reactors.map((value) => buildActivityUser(value)) : [],
    labels: labels ?? [],
    issueType: rest.issueType ?? null,
    milestone: rest.milestone ?? null,
    hasParentIssue: rest.hasParentIssue ?? false,
    hasSubIssues: rest.hasSubIssues ?? false,
    createdAt: rest.createdAt ?? "2024-01-01T00:00:00.000Z",
    updatedAt: rest.updatedAt ?? "2024-01-02T00:00:00.000Z",
    closedAt: rest.closedAt ?? null,
    mergedAt: rest.mergedAt ?? null,
    businessDaysOpen: rest.businessDaysOpen ?? 3,
    businessDaysIdle: rest.businessDaysIdle ?? 1,
    businessDaysSinceInProgress: rest.businessDaysSinceInProgress ?? 2,
    businessDaysInProgressOpen: rest.businessDaysInProgressOpen ?? null,
    attention: {
      ...DEFAULT_ATTENTION_FLAGS,
      ...(attention ?? {}),
    },
    ...rest,
  };

  return item;
}

export function buildActivityItemDetail(
  overrides: ActivityItemDetailOverrides = {},
): ActivityItemDetail {
  const baseItem = overrides.item ?? buildActivityItem();
  const baseComments = overrides.comments ?? [];
  const resolvedCommentCount =
    overrides.commentCount ?? baseComments.length ?? 0;

  const base: ActivityItemDetail = {
    item: baseItem,
    body: overrides.body ?? null,
    bodyHtml: overrides.bodyHtml ?? null,
    raw: overrides.raw ?? {},
    parentIssues: overrides.parentIssues ?? [],
    subIssues: overrides.subIssues ?? [],
    linkedPullRequests:
      overrides.linkedPullRequests ?? baseItem.linkedPullRequests,
    linkedIssues: overrides.linkedIssues ?? baseItem.linkedIssues,
    todoStatusTimes: overrides.todoStatusTimes ?? {},
    activityStatusTimes: overrides.activityStatusTimes ?? {},
    comments: baseComments,
    commentCount: resolvedCommentCount,
  };

  return {
    ...base,
    ...overrides,
    item: baseItem,
    comments: baseComments,
    commentCount: resolvedCommentCount,
  };
}

export function buildActivityPageInfo(
  overrides: ActivityPageInfoOverrides = {},
): ActivityPageInfo {
  return {
    page: overrides.page ?? 1,
    perPage: overrides.perPage ?? 25,
    totalCount: overrides.totalCount ?? 1,
    totalPages: overrides.totalPages ?? 1,
    ...overrides,
  };
}

export function buildActivityListResult(
  overrides: ActivityListResultOverrides = {},
): ActivityListResult {
  const items = overrides.items?.map((item) => buildActivityItem(item)) ?? [
    buildActivityItem(),
  ];
  const pageInfo = overrides.pageInfo
    ? buildActivityPageInfo(overrides.pageInfo)
    : buildActivityPageInfo();
  const lastSyncCompletedAt =
    overrides.lastSyncCompletedAt !== undefined
      ? overrides.lastSyncCompletedAt
      : "2024-01-03T00:00:00.000Z";
  const timezone =
    overrides.timezone !== undefined ? overrides.timezone : "UTC";
  const dateTimeFormat =
    overrides.dateTimeFormat !== undefined ? overrides.dateTimeFormat : "auto";

  return {
    items,
    pageInfo,
    lastSyncCompletedAt,
    timezone,
    dateTimeFormat,
  };
}

export function buildActivityThresholds(
  overrides: ActivityThresholds = {},
): ActivityThresholds {
  return {
    unansweredMentionDays: overrides.unansweredMentionDays ?? 5,
    reviewRequestDays: overrides.reviewRequestDays ?? 5,
    stalePrDays: overrides.stalePrDays ?? 20,
    idlePrDays: overrides.idlePrDays ?? 10,
    backlogIssueDays: overrides.backlogIssueDays ?? 40,
    stalledIssueDays: overrides.stalledIssueDays ?? 20,
  };
}

export function resetActivityHelperCounters() {
  activityItemCounter = 0;
  activityUserCounter = 0;
  activityRepoCounter = 0;
}
