import type {
  ActivityFilterOptions,
  ActivityItem,
  ActivityItemDetail,
  ActivityListParams,
  ActivityListResult,
  ActivityPrefetchPageInfo,
  ActivitySavedFilter,
  ActivitySummaryPageInfo,
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
    linkedPullRequests: [],
    linkedIssues: [],
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
    linkedPullRequests: [],
    linkedIssues: [],
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

type ActivityListResultFixtureOverrides = Partial<
  Omit<ActivityListResult, "pageInfo">
> & {
  pageInfo?:
    | Partial<ActivityPrefetchPageInfo>
    | Partial<ActivitySummaryPageInfo>;
};

export function buildActivityListResultFixture(
  overrides: ActivityListResultFixtureOverrides = {},
): ActivityListResult {
  const items = overrides.items?.map((item) =>
    buildActivityItemFixture(item),
  ) ?? [buildActivityItemFixture()];
  const pageInfoOverride = overrides.pageInfo ?? {};
  const perPage =
    (pageInfoOverride as Partial<ActivityPrefetchPageInfo>).perPage ?? 25;
  const page =
    (pageInfoOverride as Partial<ActivityPrefetchPageInfo>).page ?? 1;
  // Prefetch fixture support is legacy and should not be extended.
  const isPrefetch =
    (pageInfoOverride as Partial<ActivityPrefetchPageInfo>).isPrefetch ?? false;
  const expiresAtDefault = new Date(
    new Date(NOW).getTime() + 5 * 60 * 1000,
  ).toISOString();

  const pageInfo: ActivityListResult["pageInfo"] = isPrefetch
    ? (() => {
        const override = pageInfoOverride as Partial<ActivityPrefetchPageInfo>;
        const requestedPages = override.requestedPages ?? 3;
        const bufferedPages =
          override.bufferedPages ??
          (items.length
            ? Math.min(requestedPages, Math.ceil(items.length / perPage))
            : 0);
        const bufferedUntilPage =
          override.bufferedUntilPage ??
          (bufferedPages > 0 ? page + bufferedPages - 1 : page);
        const hasMore = override.hasMore ?? false;
        return {
          page,
          perPage,
          bufferedPages,
          bufferedUntilPage,
          requestedPages,
          hasMore,
          isPrefetch: true,
          requestToken: override.requestToken ?? "prefetch-token",
          issuedAt: override.issuedAt ?? NOW,
          expiresAt: override.expiresAt ?? expiresAtDefault,
        } satisfies ActivityPrefetchPageInfo;
      })()
    : (() => {
        const override = pageInfoOverride as Partial<ActivitySummaryPageInfo>;
        const totalCount = override.totalCount ?? items.length;
        const totalPages =
          override.totalPages ??
          (totalCount > 0 && perPage > 0
            ? Math.ceil(totalCount / perPage)
            : totalCount > 0
              ? 1
              : 0);
        return {
          page,
          perPage,
          totalCount,
          totalPages,
          isPrefetch: false,
          requestToken: override.requestToken ?? "",
          issuedAt: override.issuedAt ?? NOW,
          expiresAt: override.expiresAt ?? null,
        } satisfies ActivitySummaryPageInfo;
      })();

  return {
    items,
    pageInfo,
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
    issuePriorities: [],
    issueWeights: [],
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
    issuePriorities: ["P0", "P1", "P2"],
    issueWeights: ["Heavy", "Medium", "Light"],
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
