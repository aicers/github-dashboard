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
} from "@/lib/activity/types";

function parseEnumValues<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
) {
  const values = searchParams.getAll(key).map((value) => value.trim());
  if (!values.length) {
    return undefined;
  }

  const set = new Set<T>();
  values.forEach((value) => {
    if (allowed.includes(value as T)) {
      set.add(value as T);
    }
  });

  return set.size ? Array.from(set) : undefined;
}

function parseStringList(searchParams: URLSearchParams, key: string) {
  const values = searchParams
    .getAll(key)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length ? Array.from(new Set(values)) : undefined;
}

function parsePositiveInteger(
  searchParams: URLSearchParams,
  key: string,
  { min, max }: { min?: number; max?: number } = {},
) {
  const raw = searchParams.get(key);
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  if (typeof min === "number" && value < min) {
    return min;
  }

  if (typeof max === "number" && value > max) {
    return max;
  }

  return value;
}

function parseThresholds(searchParams: URLSearchParams) {
  const keys: Array<{
    query: string;
    field: keyof ActivityThresholds;
  }> = [
    { query: "unansweredMentionDays", field: "unansweredMentionDays" },
    { query: "reviewRequestDays", field: "reviewRequestDays" },
    { query: "stalePrDays", field: "stalePrDays" },
    { query: "idlePrDays", field: "idlePrDays" },
    { query: "backlogIssueDays", field: "backlogIssueDays" },
    { query: "stalledIssueDays", field: "stalledIssueDays" },
  ];

  const thresholds: ActivityThresholds = {};
  keys.forEach(({ query, field }) => {
    const value = parsePositiveInteger(searchParams, query, { min: 1 });
    if (typeof value === "number") {
      thresholds[field] = value;
    }
  });

  return Object.keys(thresholds).length ? thresholds : undefined;
}

export function parseActivityListParams(
  searchParams: URLSearchParams,
): ActivityListParams {
  const categoryValues =
    parseEnumValues<ActivityItemType>(searchParams, "category", [
      "issue",
      "pull_request",
      "discussion",
    ]) ??
    parseEnumValues<ActivityItemType>(searchParams, "type", [
      "issue",
      "pull_request",
      "discussion",
    ]);

  const mentionAiParam =
    searchParams.get("mentionAi") ?? searchParams.get("useMentionAi");
  const mentionAiNormalized = mentionAiParam
    ? mentionAiParam.trim().toLowerCase()
    : null;
  const useMentionAi =
    mentionAiNormalized &&
    ["0", "false", "off", "no"].includes(mentionAiNormalized)
      ? false
      : undefined;

  return {
    page: parsePositiveInteger(searchParams, "page", { min: 1 }),
    perPage: parsePositiveInteger(searchParams, "perPage", {
      min: 1,
      max: 100,
    }),
    types: categoryValues,
    repositoryIds: parseStringList(searchParams, "repositoryId"),
    labelKeys: parseStringList(searchParams, "labelKey"),
    issueTypeIds: parseStringList(searchParams, "issueTypeId"),
    issuePriorities: parseEnumValues<ActivityIssuePriorityFilter>(
      searchParams,
      "issuePriority",
      ["P0", "P1", "P2"],
    ),
    issueWeights: parseEnumValues<ActivityIssueWeightFilter>(
      searchParams,
      "issueWeight",
      ["Heavy", "Medium", "Light"],
    ),
    milestoneIds: parseStringList(searchParams, "milestoneId"),
    pullRequestStatuses: parseEnumValues<ActivityPullRequestStatusFilter>(
      searchParams,
      "prStatus",
      ["pr_open", "pr_merged", "pr_closed"],
    ),
    issueBaseStatuses: parseEnumValues<ActivityIssueBaseStatusFilter>(
      searchParams,
      "issueBaseStatus",
      ["issue_open", "issue_closed"],
    ),
    authorIds: parseStringList(searchParams, "authorId"),
    assigneeIds: parseStringList(searchParams, "assigneeId"),
    reviewerIds: parseStringList(searchParams, "reviewerId"),
    mentionedUserIds: parseStringList(searchParams, "mentionedUserId"),
    commenterIds: parseStringList(searchParams, "commenterId"),
    reactorIds: parseStringList(searchParams, "reactorId"),
    maintainerIds: parseStringList(searchParams, "maintainerId"),
    peopleSelection: parseStringList(searchParams, "peopleSelection"),
    statuses: parseEnumValues<ActivityStatusFilter>(searchParams, "status", [
      "open",
      "closed",
      "merged",
      "no_status",
      "todo",
      "in_progress",
      "done",
      "pending",
      "canceled",
    ]),
    attention: Array.from(
      new Set(
        (
          parseEnumValues<ActivityAttentionFilter>(searchParams, "attention", [
            "unanswered_mentions",
            "review_requests_pending",
            "pr_open_too_long",
            "pr_inactive",
            "issue_backlog",
            "issue_stalled",
            "no_attention",
          ]) ?? []
        )
          .filter(
            (value): value is ActivityAttentionFilter =>
              typeof value === "string",
          )
          .map((value) =>
            value === "pr_open_too_long" ? "pr_inactive" : value,
          ),
      ),
    ),
    linkedIssueStates: parseEnumValues<ActivityLinkedIssueFilter>(
      searchParams,
      "linkedIssue",
      ["has_parent", "has_sub"],
    ),
    search: searchParams.get("search"),
    jumpToDate: searchParams.get("jumpTo"),
    thresholds: parseThresholds(searchParams),
    useMentionAi,
  };
}

export function createSearchParamsFromRecord(
  record: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  const seen = new Map<string, Set<string>>();
  Object.entries(record).forEach(([key, value]) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed.length) {
        return;
      }
      const cache = seen.get(key) ?? new Set<string>();
      if (!cache.has(trimmed)) {
        params.append(key, trimmed);
        cache.add(trimmed);
        seen.set(key, cache);
      }
    } else if (Array.isArray(value)) {
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
        .forEach((entry) => {
          const cache = seen.get(key) ?? new Set<string>();
          if (!cache.has(entry)) {
            params.append(key, entry);
            cache.add(entry);
            seen.set(key, cache);
          }
        });
    }
  });
  return params;
}
