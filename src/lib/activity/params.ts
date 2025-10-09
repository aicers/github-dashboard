import type {
  ActivityAttentionFilter,
  ActivityItemType,
  ActivityListParams,
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
  return {
    page: parsePositiveInteger(searchParams, "page", { min: 1 }),
    perPage: parsePositiveInteger(searchParams, "perPage", {
      min: 1,
      max: 100,
    }),
    types: parseEnumValues<ActivityItemType>(searchParams, "type", [
      "issue",
      "pull_request",
      "discussion",
    ]),
    repositoryIds: parseStringList(searchParams, "repositoryId"),
    labelKeys: parseStringList(searchParams, "labelKey"),
    authorIds: parseStringList(searchParams, "authorId"),
    assigneeIds: parseStringList(searchParams, "assigneeId"),
    reviewerIds: parseStringList(searchParams, "reviewerId"),
    mentionedUserIds: parseStringList(searchParams, "mentionedUserId"),
    commenterIds: parseStringList(searchParams, "commenterId"),
    reactorIds: parseStringList(searchParams, "reactorId"),
    statuses: parseEnumValues<ActivityStatusFilter>(searchParams, "status", [
      "open",
      "closed",
      "merged",
    ]),
    attention: parseEnumValues<ActivityAttentionFilter>(
      searchParams,
      "attention",
      [
        "unanswered_mentions",
        "review_requests_pending",
        "pr_open_too_long",
        "pr_inactive",
        "issue_backlog",
        "issue_stalled",
      ],
    ),
    search: searchParams.get("search"),
    jumpToDate: searchParams.get("jumpTo"),
    thresholds: parseThresholds(searchParams),
  };
}

export function createSearchParamsFromRecord(
  record: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  Object.entries(record).forEach(([key, value]) => {
    if (typeof value === "string") {
      params.append(key, value);
    } else if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === "string") {
          params.append(key, entry);
        }
      });
    }
  });
  return params;
}
