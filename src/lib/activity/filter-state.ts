import type {
  ActivityAttentionFilter,
  ActivityIssueBaseStatusFilter,
  ActivityIssuePriorityFilter,
  ActivityIssueWeightFilter,
  ActivityItemType,
  ActivityLinkedIssueFilter,
  ActivityListParams,
  ActivityPullRequestStatusFilter,
  ActivityStatusFilter,
  ActivityThresholds,
  OptionalPeopleMap,
  PeopleFilterMap,
  PeopleRoleKey,
} from "@/lib/activity/types";

export type ActivityFilterState = {
  page: number;
  perPage: number;
  categories: ActivityItemType[];
  repositoryIds: string[];
  labelKeys: string[];
  issueTypeIds: string[];
  issuePriorities: ActivityIssuePriorityFilter[];
  issueWeights: ActivityIssueWeightFilter[];
  milestoneIds: string[];
  prStatuses: ActivityPullRequestStatusFilter[];
  issueBaseStatuses: ActivityIssueBaseStatusFilter[];
  authorIds: string[];
  assigneeIds: string[];
  reviewerIds: string[];
  mentionedUserIds: string[];
  commenterIds: string[];
  reactorIds: string[];
  maintainerIds: string[];
  peopleSelection: string[];
  peopleFilters: PeopleFilterMap;
  statuses: ActivityStatusFilter[];
  attention: ActivityAttentionFilter[];
  linkedIssueStates: ActivityLinkedIssueFilter[];
  search: string;
  thresholds: Required<ActivityThresholds>;
  optionalPersonIds: OptionalPeopleMap;
  useMentionAi: boolean;
};

export const DEFAULT_THRESHOLD_VALUES: Required<ActivityThresholds> = {
  unansweredMentionDays: 5,
  reviewRequestDays: 5,
  stalePrDays: 20,
  idlePrDays: 10,
  backlogIssueDays: 40,
  stalledIssueDays: 20,
};

export function buildFilterState(
  params: ActivityListParams,
  perPageFallback: number,
): ActivityFilterState {
  const peopleFilters: PeopleFilterMap = {
    authorIds: Array.isArray(params.authorIds) ? [...params.authorIds] : [],
    assigneeIds: Array.isArray(params.assigneeIds)
      ? [...params.assigneeIds]
      : [],
    reviewerIds: Array.isArray(params.reviewerIds)
      ? [...params.reviewerIds]
      : [],
    mentionedUserIds: Array.isArray(params.mentionedUserIds)
      ? [...params.mentionedUserIds]
      : [],
    commenterIds: Array.isArray(params.commenterIds)
      ? [...params.commenterIds]
      : [],
    reactorIds: Array.isArray(params.reactorIds) ? [...params.reactorIds] : [],
    maintainerIds: Array.isArray(params.maintainerIds)
      ? [...params.maintainerIds]
      : [],
  };

  const optionalPersonIds = cloneOptionalPeopleMap(
    params.optionalPersonIds as OptionalPeopleMap | undefined,
  );

  const peopleSelection = Array.isArray(params.peopleSelection)
    ? Array.from(new Set(params.peopleSelection))
    : [];

  return {
    page: params.page && params.page > 0 ? params.page : 1,
    perPage:
      params.perPage && params.perPage > 0 ? params.perPage : perPageFallback,
    categories: params.types ?? [],
    repositoryIds: params.repositoryIds ?? [],
    labelKeys: params.labelKeys ?? [],
    issueTypeIds: params.issueTypeIds ?? [],
    issuePriorities: params.issuePriorities ?? [],
    issueWeights: params.issueWeights ?? [],
    milestoneIds: params.milestoneIds ?? [],
    prStatuses: params.pullRequestStatuses ?? [],
    issueBaseStatuses: params.issueBaseStatuses ?? [],
    authorIds: [...peopleFilters.authorIds],
    assigneeIds: [...peopleFilters.assigneeIds],
    reviewerIds: [...peopleFilters.reviewerIds],
    mentionedUserIds: [...peopleFilters.mentionedUserIds],
    commenterIds: [...peopleFilters.commenterIds],
    reactorIds: [...peopleFilters.reactorIds],
    maintainerIds: [...peopleFilters.maintainerIds],
    peopleSelection,
    peopleFilters,
    statuses: params.statuses ?? [],
    attention: params.attention ?? [],
    linkedIssueStates: params.linkedIssueStates ?? [],
    search: params.search ?? "",
    thresholds: {
      ...DEFAULT_THRESHOLD_VALUES,
      ...(params.thresholds ?? {}),
    },
    useMentionAi: params.useMentionAi ?? true,
    optionalPersonIds,
  };
}

function cloneOptionalPeopleMap(source?: OptionalPeopleMap): OptionalPeopleMap {
  if (!source) {
    return {};
  }
  const result: OptionalPeopleMap = {};
  for (const role of Object.keys(source) as PeopleRoleKey[]) {
    const values = source[role];
    if (Array.isArray(values) && values.length > 0) {
      result[role] = [...values];
    }
  }
  return result;
}

export function buildSavedFilterPayload(
  filters: ActivityFilterState,
): ActivityListParams {
  const thresholdsEntries = (
    Object.entries(filters.thresholds) as Array<
      [keyof ActivityThresholds, number]
    >
  ).filter(([key, value]) => {
    const defaultValue = DEFAULT_THRESHOLD_VALUES[key] ?? null;
    return defaultValue === null || value !== defaultValue;
  });

  const thresholds =
    thresholdsEntries.length > 0
      ? thresholdsEntries.reduce<ActivityThresholds>(
          (accumulator, [key, value]) => {
            accumulator[key] = value;
            return accumulator;
          },
          {},
        )
      : undefined;

  const trimmedSearch = filters.search.trim();

  const payload: ActivityListParams = {
    perPage: filters.perPage,
    types: filters.categories.length ? [...filters.categories] : undefined,
    repositoryIds: filters.repositoryIds.length
      ? [...filters.repositoryIds]
      : undefined,
    labelKeys: filters.labelKeys.length ? [...filters.labelKeys] : undefined,
    issueTypeIds: filters.issueTypeIds.length
      ? [...filters.issueTypeIds]
      : undefined,
    issuePriorities: filters.issuePriorities.length
      ? [...filters.issuePriorities]
      : undefined,
    issueWeights: filters.issueWeights.length
      ? [...filters.issueWeights]
      : undefined,
    milestoneIds: filters.milestoneIds.length
      ? [...filters.milestoneIds]
      : undefined,
    pullRequestStatuses: filters.prStatuses.length
      ? [...filters.prStatuses]
      : undefined,
    issueBaseStatuses: filters.issueBaseStatuses.length
      ? [...filters.issueBaseStatuses]
      : undefined,
    authorIds: filters.authorIds.length ? [...filters.authorIds] : undefined,
    assigneeIds: filters.assigneeIds.length
      ? [...filters.assigneeIds]
      : undefined,
    reviewerIds: filters.reviewerIds.length
      ? [...filters.reviewerIds]
      : undefined,
    mentionedUserIds: filters.mentionedUserIds.length
      ? [...filters.mentionedUserIds]
      : undefined,
    commenterIds: filters.commenterIds.length
      ? [...filters.commenterIds]
      : undefined,
    reactorIds: filters.reactorIds.length ? [...filters.reactorIds] : undefined,
    maintainerIds: filters.maintainerIds.length
      ? [...filters.maintainerIds]
      : undefined,
    peopleSelection: filters.peopleSelection.length
      ? [...filters.peopleSelection]
      : undefined,
    optionalPersonIds:
      filters.optionalPersonIds &&
      Object.values(filters.optionalPersonIds).some(
        (value) => Array.isArray(value) && value.length > 0,
      )
        ? Object.fromEntries(
            Object.entries(filters.optionalPersonIds).map(([key, value]) => [
              key,
              Array.isArray(value) ? [...value] : [],
            ]),
          )
        : undefined,
    statuses: filters.statuses.length ? [...filters.statuses] : undefined,
    attention: filters.attention.length ? [...filters.attention] : undefined,
    linkedIssueStates: filters.linkedIssueStates.length
      ? [...filters.linkedIssueStates]
      : undefined,
    search: trimmedSearch.length ? trimmedSearch : undefined,
    thresholds,
  };

  if (filters.useMentionAi === false) {
    payload.useMentionAi = false;
  }

  return payload;
}

export function normalizeSearchParams(
  filters: ActivityFilterState,
  defaultPerPage: number,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.page > 1) {
    params.set("page", filters.page.toString());
  }
  if (filters.perPage !== defaultPerPage) {
    params.set("perPage", filters.perPage.toString());
  }

  const appendAll = (key: string, values: string[]) => {
    values.forEach((value) => {
      params.append(key, value);
    });
  };

  if (filters.categories.length) {
    appendAll(
      "category",
      filters.categories.map((value) => value),
    );
  }

  appendAll("repositoryId", filters.repositoryIds);
  appendAll("labelKey", filters.labelKeys);
  appendAll("issueTypeId", filters.issueTypeIds);
  appendAll(
    "issuePriority",
    filters.issuePriorities.map((value) => value),
  );
  appendAll(
    "issueWeight",
    filters.issueWeights.map((value) => value),
  );
  appendAll("milestoneId", filters.milestoneIds);
  appendAll(
    "prStatus",
    filters.prStatuses.map((value) => value),
  );
  appendAll(
    "issueBaseStatus",
    filters.issueBaseStatuses.map((value) => value),
  );
  appendAll("authorId", filters.authorIds);
  appendAll("assigneeId", filters.assigneeIds);
  appendAll("reviewerId", filters.reviewerIds);
  appendAll("mentionedUserId", filters.mentionedUserIds);
  appendAll("commenterId", filters.commenterIds);
  appendAll("reactorId", filters.reactorIds);
  appendAll("maintainerId", filters.maintainerIds);
  appendAll(
    "status",
    filters.statuses.map((value) => value),
  );
  appendAll(
    "attention",
    filters.attention.map((value) => value),
  );
  appendAll(
    "linkedIssue",
    filters.linkedIssueStates.map((value) => value),
  );

  if (filters.search.trim().length) {
    params.set("search", filters.search.trim());
  }

  (
    Object.entries(filters.thresholds) as Array<
      [keyof ActivityThresholds, number]
    >
  ).forEach(([key, value]) => {
    const defaultValue = DEFAULT_THRESHOLD_VALUES[key] ?? null;
    if (defaultValue !== null && value !== defaultValue) {
      params.set(key, value.toString());
    }
  });

  if (filters.useMentionAi === false) {
    params.set("mentionAi", "0");
  }

  return params;
}
