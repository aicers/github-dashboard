import type {
  ActivityFilterOptions,
  ActivityItem,
  ActivityItemDetail,
  ActivityListParams,
  ActivityListResult,
  ActivitySavedFilter,
  ActivityUser,
} from "@/lib/activity/types";

const NOW = "2024-04-01T10:00:00.000Z";

const BASE_USERS: ActivityUser[] = [
  {
    id: "user-self",
    login: "self",
    name: "Self User",
    avatarUrl: null,
  },
  {
    id: "user-alice",
    login: "alice",
    name: "Alice",
    avatarUrl: null,
  },
  {
    id: "user-bob",
    login: "bob",
    name: "Bob",
    avatarUrl: null,
  },
];

export function buildActivityUserFixture(
  overrides: Partial<ActivityUser> = {},
): ActivityUser {
  return {
    id: "user-fixture",
    login: "fixture",
    name: "Fixture User",
    avatarUrl: null,
    ...overrides,
  };
}

export function buildActivityItemFixture(
  overrides: Partial<ActivityItem> = {},
): ActivityItem {
  const base: ActivityItem = {
    id: "issue-1",
    type: "issue",
    number: 101,
    title: "Controller returns incorrect status",
    url: "https://example.com/acme/alpha/issues/101",
    state: "OPEN",
    status: "open",
    issueProjectStatus: "todo",
    issueProjectStatusSource: "activity",
    issueProjectStatusLocked: false,
    issueTodoProjectStatus: "todo",
    issueTodoProjectStatusAt: NOW,
    issueTodoProjectPriority: "P1",
    issueTodoProjectPriorityUpdatedAt: NOW,
    issueTodoProjectWeight: "Medium",
    issueTodoProjectWeightUpdatedAt: NOW,
    issueTodoProjectInitiationOptions: "Open to Start",
    issueTodoProjectInitiationOptionsUpdatedAt: NOW,
    issueTodoProjectStartDate: "2024-04-10",
    issueTodoProjectStartDateUpdatedAt: NOW,
    issueActivityStatus: "todo",
    issueActivityStatusAt: NOW,
    repository: {
      id: "repo-alpha",
      name: "alpha",
      nameWithOwner: "acme/alpha",
    },
    author: BASE_USERS[0],
    assignees: [BASE_USERS[1]],
    reviewers: [BASE_USERS[2]],
    mentionedUsers: [],
    commenters: [],
    reactors: [],
    labels: [
      {
        key: "bug",
        name: "bug",
        repositoryId: "repo-alpha",
        repositoryNameWithOwner: "acme/alpha",
      },
    ],
    issueType: {
      id: "issue-type-bug",
      name: "Bug",
    },
    milestone: {
      id: "milestone-1",
      title: "Sprint 1",
      state: "OPEN",
      dueOn: "2024-05-01",
      url: "https://example.com/acme/alpha/milestones/1",
    },
    hasParentIssue: false,
    hasSubIssues: false,
    createdAt: "2024-03-20T12:00:00.000Z",
    updatedAt: NOW,
    closedAt: null,
    mergedAt: null,
    businessDaysOpen: 5,
    businessDaysIdle: 1,
    businessDaysSinceInProgress: 2,
    businessDaysInProgressOpen: null,
    attention: {
      unansweredMention: false,
      reviewRequestPending: false,
      staleOpenPr: false,
      idlePr: false,
      backlogIssue: false,
      stalledIssue: false,
    },
  };

  return {
    ...base,
    ...overrides,
    repository: overrides.repository ?? base.repository,
    author: overrides.author ?? base.author,
    attention: overrides.attention
      ? { ...base.attention, ...overrides.attention }
      : base.attention,
  };
}

export function buildActivityItemDetailFixture(
  overrides: Partial<ActivityItemDetail> = {},
): ActivityItemDetail {
  const baseItem =
    overrides.item != null
      ? buildActivityItemFixture(overrides.item)
      : buildActivityItemFixture();

  const base: ActivityItemDetail = {
    item: baseItem,
    body: "Fixture detail body for the selected activity item.",
    bodyHtml: null,
    raw: {},
    parentIssues: [],
    subIssues: [],
    comments: [],
    commentCount: 0,
    todoStatusTimes: {
      todo: "2024-03-22T00:00:00.000Z",
      in_progress: "2024-03-24T00:00:00.000Z",
    },
    activityStatusTimes: {
      todo: "2024-03-22T00:00:00.000Z",
    },
  };

  const comments = overrides.comments ?? base.comments;
  const commentCount =
    overrides.commentCount ?? (comments ? comments.length : base.commentCount);

  return {
    ...base,
    ...overrides,
    item: baseItem,
    comments,
    commentCount,
  };
}

export function buildActivityListResultFixture(
  overrides: Partial<ActivityListResult> = {},
): ActivityListResult {
  const items = overrides.items?.map((item) =>
    buildActivityItemFixture(item),
  ) ?? [buildActivityItemFixture()];

  return {
    items,
    pageInfo: {
      page: 1,
      perPage: 25,
      totalCount: items.length,
      totalPages: 1,
      ...(overrides.pageInfo ?? {}),
    },
    lastSyncCompletedAt: overrides.lastSyncCompletedAt ?? NOW,
    timezone: overrides.timezone ?? "UTC",
    dateTimeFormat: overrides.dateTimeFormat ?? "auto",
  };
}

export function buildActivityListParamsFixture(
  overrides: Partial<ActivityListParams> = {},
): ActivityListParams {
  return {
    page: 1,
    perPage: 25,
    types: [],
    repositoryIds: [],
    labelKeys: [],
    issueTypeIds: [],
    milestoneIds: [],
    pullRequestStatuses: [],
    issueBaseStatuses: [],
    authorIds: [],
    assigneeIds: [],
    reviewerIds: [],
    mentionedUserIds: [],
    commenterIds: [],
    reactorIds: [],
    statuses: [],
    attention: [],
    linkedIssueStates: [],
    search: "",
    thresholds: {},
    ...overrides,
  };
}

export function buildActivityFilterOptionsFixture(): ActivityFilterOptions {
  return {
    repositories: [
      {
        id: "repo-alpha",
        name: "alpha",
        nameWithOwner: "acme/alpha",
      },
      {
        id: "repo-beta",
        name: "beta",
        nameWithOwner: "acme/beta",
      },
    ],
    labels: [
      {
        key: "bug",
        name: "Bug",
        repositoryId: "repo-alpha",
        repositoryNameWithOwner: "acme/alpha",
      },
      {
        key: "feature",
        name: "Feature",
        repositoryId: "repo-beta",
        repositoryNameWithOwner: "acme/beta",
      },
    ],
    users: BASE_USERS,
    issueTypes: [
      {
        id: "issue-type-bug",
        name: "Bug",
      },
      {
        id: "issue-type-feature",
        name: "Feature",
      },
    ],
    milestones: [
      {
        id: "milestone-1",
        title: "Sprint 1",
        state: "OPEN",
        dueOn: "2024-05-01",
        url: "https://example.com/milestones/1",
      },
    ],
  };
}

export function buildActivitySavedFilterFixture(
  overrides: Partial<ActivitySavedFilter> = {},
): ActivitySavedFilter {
  return {
    id: "saved-filter-1",
    name: "Critical issues",
    payload: buildActivityListParamsFixture({
      repositoryIds: ["repo-alpha"],
      statuses: ["open"],
    }),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
