import type {
  ActivityAttentionFilter,
  ActivityIssueBaseStatusFilter,
  ActivityItemType,
  ActivityLinkedIssueFilter,
  ActivityListParams,
  ActivityPullRequestStatusFilter,
  ActivityStatusFilter,
  ActivityThresholds,
} from "@/lib/activity/types";

export type ActivityFilterState = {
  page: number;
  perPage: number;
  categories: ActivityItemType[];
  repositoryIds: string[];
  labelKeys: string[];
  issueTypeIds: string[];
  milestoneIds: string[];
  prStatuses: ActivityPullRequestStatusFilter[];
  issueBaseStatuses: ActivityIssueBaseStatusFilter[];
  authorIds: string[];
  assigneeIds: string[];
  reviewerIds: string[];
  mentionedUserIds: string[];
  commenterIds: string[];
  reactorIds: string[];
  statuses: ActivityStatusFilter[];
  attention: ActivityAttentionFilter[];
  linkedIssueStates: ActivityLinkedIssueFilter[];
  search: string;
  thresholds: Required<ActivityThresholds>;
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
  return {
    page: params.page && params.page > 0 ? params.page : 1,
    perPage:
      params.perPage && params.perPage > 0 ? params.perPage : perPageFallback,
    categories: params.types ?? [],
    repositoryIds: params.repositoryIds ?? [],
    labelKeys: params.labelKeys ?? [],
    issueTypeIds: params.issueTypeIds ?? [],
    milestoneIds: params.milestoneIds ?? [],
    prStatuses: params.pullRequestStatuses ?? [],
    issueBaseStatuses: params.issueBaseStatuses ?? [],
    authorIds: params.authorIds ?? [],
    assigneeIds: params.assigneeIds ?? [],
    reviewerIds: params.reviewerIds ?? [],
    mentionedUserIds: params.mentionedUserIds ?? [],
    commenterIds: params.commenterIds ?? [],
    reactorIds: params.reactorIds ?? [],
    statuses: params.statuses ?? [],
    attention: params.attention ?? [],
    linkedIssueStates: params.linkedIssueStates ?? [],
    search: params.search ?? "",
    thresholds: {
      ...DEFAULT_THRESHOLD_VALUES,
      ...(params.thresholds ?? {}),
    },
  };
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

  return {
    perPage: filters.perPage,
    types: filters.categories.length ? [...filters.categories] : undefined,
    repositoryIds: filters.repositoryIds.length
      ? [...filters.repositoryIds]
      : undefined,
    labelKeys: filters.labelKeys.length ? [...filters.labelKeys] : undefined,
    issueTypeIds: filters.issueTypeIds.length
      ? [...filters.issueTypeIds]
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
    statuses: filters.statuses.length ? [...filters.statuses] : undefined,
    attention: filters.attention.length ? [...filters.attention] : undefined,
    linkedIssueStates: filters.linkedIssueStates.length
      ? [...filters.linkedIssueStates]
      : undefined,
    search: trimmedSearch.length ? trimmedSearch : undefined,
    thresholds,
  };
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

  return params;
}
