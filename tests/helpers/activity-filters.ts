import {
  type ActivityFilterState,
  DEFAULT_THRESHOLD_VALUES,
} from "@/lib/activity/filter-state";
import type {
  ActivityItemType,
  ActivityListParams,
  ActivityStatusFilter,
} from "@/lib/activity/types";

const DEFAULT_CATEGORIES: ActivityItemType[] = [];
const DEFAULT_STATUSES: ActivityStatusFilter[] = [];

export function buildActivityListParams(
  overrides: Partial<ActivityListParams> = {},
): ActivityListParams {
  return {
    page: 1,
    perPage: 25,
    types: DEFAULT_CATEGORIES,
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
    statuses: DEFAULT_STATUSES,
    attention: [],
    linkedIssueStates: [],
    search: "",
    thresholds: {},
    ...overrides,
  };
}

export function buildActivityFilterState(
  overrides: Partial<ActivityFilterState> = {},
): ActivityFilterState {
  const { thresholds, ...restOverrides } = overrides;

  return {
    page: 1,
    perPage: 25,
    categories: [],
    repositoryIds: [],
    labelKeys: [],
    issueTypeIds: [],
    issuePriorities: [],
    issueWeights: [],
    milestoneIds: [],
    prStatuses: [],
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
    ...restOverrides,
    thresholds: {
      ...DEFAULT_THRESHOLD_VALUES,
      ...(thresholds ?? {}),
    },
  };
}

export function collectSearchParams(
  params: URLSearchParams,
): Array<[string, string]> {
  return Array.from(params.entries());
}
