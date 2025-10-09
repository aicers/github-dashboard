"use client";

import { DateTime } from "luxon";
import { useRouter } from "next/navigation";
import {
  type FC,
  type KeyboardEvent,
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ActivityAttentionFilter,
  ActivityFilterOptions,
  ActivityItem,
  ActivityItemType as ActivityItemCategory,
  ActivityItemDetail,
  ActivityListParams,
  ActivityListResult,
  ActivityStatusFilter,
  ActivityThresholds,
} from "@/lib/activity/types";
import { cn } from "@/lib/utils";

type ActivityViewProps = {
  initialData: ActivityListResult;
  filterOptions: ActivityFilterOptions;
  initialParams: ActivityListParams;
};

type FilterState = {
  page: number;
  perPage: number;
  categories: ActivityItemCategory[];
  repositoryIds: string[];
  labelKeys: string[];
  authorIds: string[];
  assigneeIds: string[];
  reviewerIds: string[];
  mentionedUserIds: string[];
  commenterIds: string[];
  reactorIds: string[];
  statuses: ActivityStatusFilter[];
  attention: ActivityAttentionFilter[];
  search: string;
  thresholds: Required<ActivityThresholds>;
};

type PeopleRoleKey =
  | "authorIds"
  | "assigneeIds"
  | "reviewerIds"
  | "mentionedUserIds"
  | "commenterIds"
  | "reactorIds";

type MultiSelectOption = {
  value: string;
  label: string;
  description?: string | null;
};

const ATTENTION_OPTIONS: Array<{
  value: ActivityAttentionFilter;
  label: string;
}> = [
  { value: "unanswered_mentions", label: "응답 없는 멘션" },
  { value: "review_requests_pending", label: "응답 없는 리뷰 요청" },
  { value: "pr_open_too_long", label: "오래된 PR" },
  { value: "pr_inactive", label: "업데이트 없는 PR" },
  { value: "issue_backlog", label: "정체된 Backlog 이슈" },
  { value: "issue_stalled", label: "정체된 In Progress 이슈" },
];

const CATEGORY_OPTIONS: Array<{ value: ActivityItemCategory; label: string }> =
  [
    { value: "discussion", label: "Discussion" },
    { value: "issue", label: "Issue" },
    { value: "pull_request", label: "Pull Request" },
  ];

const STATUS_OPTIONS: Array<{ value: ActivityStatusFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

const DEFAULT_THRESHOLD_VALUES: Required<ActivityThresholds> = {
  unansweredMentionDays: 5,
  reviewRequestDays: 5,
  stalePrDays: 20,
  idlePrDays: 10,
  backlogIssueDays: 40,
  stalledIssueDays: 20,
};

const PER_PAGE_CHOICES = [10, 25, 50];

const ALL_ACTIVITY_CATEGORIES = CATEGORY_OPTIONS.map(
  (option) => option.value,
) as ActivityItemCategory[];

const PEOPLE_ROLE_MAP: Record<ActivityItemCategory, PeopleRoleKey[]> = {
  issue: [
    "authorIds",
    "assigneeIds",
    "mentionedUserIds",
    "commenterIds",
    "reactorIds",
  ],
  pull_request: [
    "authorIds",
    "assigneeIds",
    "reviewerIds",
    "mentionedUserIds",
    "commenterIds",
    "reactorIds",
  ],
  discussion: ["authorIds", "mentionedUserIds", "commenterIds", "reactorIds"],
};

const PEOPLE_ROLE_KEYS: PeopleRoleKey[] = [
  "authorIds",
  "assigneeIds",
  "reviewerIds",
  "mentionedUserIds",
  "commenterIds",
  "reactorIds",
];

type LocalIconProps = SVGProps<SVGSVGElement>;

const IssueOpenIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <circle cx="8" cy="8" r="4.25" />
    <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
  </svg>
);

const IssueClosedIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <circle cx="8" cy="8" r="4.25" />
    <path
      d="M5.75 8.25l1.7 1.7 2.8-2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PullRequestOpenIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="3.5" r="1.75" />
    <path d="M4.5 5.25v5.5" strokeLinecap="round" />
    <path
      d="M7.5 5.25h1.25a3.25 3.25 0 013.25 3.25v3.5"
      strokeLinecap="round"
    />
    <path d="M10 10.75l2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PullRequestClosedIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="3.5" r="1.75" />
    <path d="M4.5 5.25v5.5" strokeLinecap="round" />
    <path
      d="M7.5 5.25h1.25a3.25 3.25 0 013.25 3.25v4.5"
      strokeLinecap="round"
    />
    <path d="M10 10.5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 10.5l-3 3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PullRequestMergedIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="8" r="1.75" />
    <path d="M4.5 5.25v5.5" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M6.75 5.25a4 4 0 004 4H9.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const DiscussionOpenIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <path
      d="M2 3.75a1.75 1.75 0 011.75-1.75h8.5A1.75 1.75 0 0114 3.75v4a1.75 1.75 0 01-1.75 1.75H8L5 12.75v-3.25H3.75A1.75 1.75 0 012 7.75v-4z"
      strokeLinejoin="round"
    />
  </svg>
);

const DiscussionClosedIcon: FC<LocalIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <path
      d="M2 3.75a1.75 1.75 0 011.75-1.75h8.5A1.75 1.75 0 0114 3.75v4a1.75 1.75 0 01-1.75 1.75H8L5 12.75v-3.25H3.75A1.75 1.75 0 012 7.75v-4z"
      strokeLinejoin="round"
    />
    <path d="M5.5 5.5l5 5" strokeLinecap="round" />
    <path d="M10.5 5.5l-5 5" strokeLinecap="round" />
  </svg>
);

type ActivityIconInfo = {
  Icon: FC<LocalIconProps>;
  className: string;
  label: string;
};

const CATEGORY_LABELS: Record<ActivityItemCategory, string> = {
  issue: "이슈",
  pull_request: "PR",
  discussion: "토론",
};

const STATUS_LABELS: Record<ActivityStatusFilter, string> = {
  open: "열림",
  closed: "닫힘",
  merged: "병합됨",
};

function resolveActivityIcon(item: ActivityItem): ActivityIconInfo {
  const typeLabel = CATEGORY_LABELS[item.type] ?? "항목";
  const statusLabel = STATUS_LABELS[item.status] ?? item.status;

  if (item.type === "pull_request") {
    if (item.status === "merged") {
      return {
        Icon: PullRequestMergedIcon,
        className: "text-purple-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    if (item.status === "closed") {
      return {
        Icon: PullRequestClosedIcon,
        className: "text-rose-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    return {
      Icon: PullRequestOpenIcon,
      className: "text-emerald-500",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  if (item.type === "issue") {
    if (item.status === "closed") {
      return {
        Icon: IssueClosedIcon,
        className: "text-rose-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    if (item.status === "merged") {
      return {
        Icon: IssueClosedIcon,
        className: "text-purple-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    return {
      Icon: IssueOpenIcon,
      className: "text-emerald-500",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  if (item.status === "closed") {
    return {
      Icon: DiscussionClosedIcon,
      className: "text-rose-500",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  return {
    Icon: DiscussionOpenIcon,
    className: "text-sky-500",
    label: `${typeLabel} ${statusLabel}`,
  };
}

function arraysShallowEqual(first: string[], second: string[]) {
  if (first.length !== second.length) {
    return false;
  }
  return first.every((value, index) => value === second[index]);
}

function resolvePeopleCategories(categories: ActivityItemCategory[]) {
  return categories.length ? categories : ALL_ACTIVITY_CATEGORIES;
}

function getPeopleRoleTargets(
  categories: ActivityItemCategory[],
): PeopleRoleKey[] {
  const targets = new Set<PeopleRoleKey>();
  resolvePeopleCategories(categories).forEach((item) => {
    for (const role of PEOPLE_ROLE_MAP[item]) {
      targets.add(role);
    }
  });
  return Array.from(targets);
}

function derivePeopleState(
  state: FilterState,
  categoriesOverride?: ActivityItemCategory[],
) {
  const resolvedCategories = categoriesOverride ?? state.categories;
  const targets = getPeopleRoleTargets(resolvedCategories);
  if (!targets.length) {
    return { selection: [], isSynced: true, targets };
  }

  let baseline: string[] | null = null;
  let inSync = true;

  for (const role of targets) {
    const values = state[role];
    if (baseline === null) {
      baseline = values;
      continue;
    }
    if (!arraysShallowEqual(baseline, values)) {
      inSync = false;
      break;
    }
  }

  if (inSync) {
    for (const role of PEOPLE_ROLE_KEYS) {
      if (targets.includes(role)) {
        continue;
      }
      if (state[role].length > 0) {
        inSync = false;
        break;
      }
    }
  }

  return {
    selection: inSync && baseline ? [...baseline] : [],
    isSynced: inSync,
    targets,
  };
}

function applyPeopleSelection(
  state: FilterState,
  peopleIds: string[],
  categoriesOverride?: ActivityItemCategory[],
): FilterState {
  const resolvedCategories = categoriesOverride ?? state.categories;
  const targets = getPeopleRoleTargets(resolvedCategories);
  const unique = Array.from(new Set(peopleIds));
  let changed = false;
  const next: FilterState = { ...state };

  targets.forEach((role) => {
    if (!arraysShallowEqual(state[role], unique)) {
      next[role] = unique;
      changed = true;
    }
  });

  PEOPLE_ROLE_KEYS.forEach((role) => {
    if (targets.includes(role)) {
      return;
    }
    if (state[role].length > 0) {
      next[role] = [];
      changed = true;
    }
  });

  if (!changed) {
    return state;
  }

  return next;
}

function sanitizePeopleIds(
  state: FilterState,
  allowed: ReadonlySet<string>,
): FilterState {
  let changed = false;
  const next: FilterState = { ...state };

  PEOPLE_ROLE_KEYS.forEach((role) => {
    const filtered = state[role].filter((id) => allowed.has(id));
    if (!arraysShallowEqual(state[role], filtered)) {
      next[role] = filtered;
      changed = true;
    }
  });

  if (!changed) {
    return state;
  }

  const peopleState = derivePeopleState(next);
  if (peopleState.isSynced) {
    return applyPeopleSelection(next, peopleState.selection);
  }

  return next;
}

function buildFilterState(
  params: ActivityListParams,
  perPageFallback: number,
): FilterState {
  return {
    page: params.page && params.page > 0 ? params.page : 1,
    perPage:
      params.perPage && params.perPage > 0 ? params.perPage : perPageFallback,
    categories: params.types ?? [],
    repositoryIds: params.repositoryIds ?? [],
    labelKeys: params.labelKeys ?? [],
    authorIds: params.authorIds ?? [],
    assigneeIds: params.assigneeIds ?? [],
    reviewerIds: params.reviewerIds ?? [],
    mentionedUserIds: params.mentionedUserIds ?? [],
    commenterIds: params.commenterIds ?? [],
    reactorIds: params.reactorIds ?? [],
    statuses: params.statuses ?? [],
    attention: params.attention ?? [],
    search: params.search ?? "",
    thresholds: {
      ...DEFAULT_THRESHOLD_VALUES,
      ...(params.thresholds ?? {}),
    },
  };
}

function normalizeSearchParams(filters: FilterState, defaultPerPage: number) {
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

function applyFiltersToQuery(
  router: ReturnType<typeof useRouter>,
  filters: FilterState,
  defaultPerPage: number,
) {
  const params = normalizeSearchParams(filters, defaultPerPage);
  const query = params.toString();
  router.replace(
    query.length ? `/dashboard/activity?${query}` : "/dashboard/activity",
    { scroll: false },
  );
}

function differenceLabel(value: number | null | undefined, suffix = "일") {
  if (value === null || value === undefined) {
    return null;
  }
  if (value <= 0) {
    return `오늘 (0${suffix})`;
  }
  return `${value.toString()}${suffix}`;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "");
}

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function formatDateTime(value: string | null, timeZone?: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const baseOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };

  const trimmedTimeZone = timeZone?.trim();
  const options = trimmedTimeZone?.length
    ? { ...baseOptions, timeZone: trimmedTimeZone }
    : baseOptions;

  try {
    const formatted = new Intl.DateTimeFormat("en-US", options).format(date);
    return trimmedTimeZone?.length
      ? `${formatted} (${trimmedTimeZone})`
      : formatted;
  } catch {
    return new Intl.DateTimeFormat("en-US", baseOptions).format(date);
  }
}

function formatRelative(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMs = date.getTime() - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, unitMs] of units) {
    const valueInUnit = diffMs / unitMs;
    if (Math.abs(valueInUnit) >= 1) {
      return formatter.format(Math.round(valueInUnit), unit);
    }
  }

  return "just now";
}

function buildAttentionBadges(item: ActivityItem) {
  const badges: string[] = [];
  if (item.attention.unansweredMention) {
    badges.push("응답 없는 멘션");
  }
  if (item.attention.reviewRequestPending) {
    badges.push("응답 없는 리뷰 요청");
  }
  if (item.attention.staleOpenPr) {
    badges.push("오래된 PR");
  }
  if (item.attention.idlePr) {
    badges.push("업데이트 없는 PR");
  }
  if (item.attention.backlogIssue) {
    badges.push("정체된 Backlog 이슈");
  }
  if (item.attention.stalledIssue) {
    badges.push("정체된 In Progress 이슈");
  }
  return badges;
}

function avatarFallback(user: ActivityItem["author"]) {
  if (!user) {
    return null;
  }

  return user.login ?? user.name ?? user.id;
}

function MultiSelectInput({
  label,
  placeholder,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  label: string;
  placeholder?: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsFocused(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => {
      if (selectedSet.has(option.value)) {
        return false;
      }
      if (!normalized.length) {
        return true;
      }
      const haystack =
        `${option.label} ${option.description ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, query, selectedSet]);

  const addValue = useCallback(
    (nextValue: string) => {
      if (selectedSet.has(nextValue)) {
        return;
      }
      onChange([...value, nextValue]);
      setQuery("");
    },
    [onChange, selectedSet, value],
  );

  const removeValue = useCallback(
    (target: string) => {
      onChange(value.filter((entry) => entry !== target));
    },
    [onChange, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace" && !query.length && value.length) {
        event.preventDefault();
        const next = [...value];
        next.pop();
        onChange(next);
      }
      if (event.key === "Enter" && query.length) {
        event.preventDefault();
        const nextCandidate = filteredOptions[0];
        if (nextCandidate) {
          addValue(nextCandidate.value);
        }
      }
    },
    [addValue, filteredOptions, onChange, query.length, value],
  );

  return (
    <div ref={containerRef} className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div
        className={cn(
          "rounded-md border border-border bg-background px-2 py-1 text-sm",
          isFocused && "ring-2 ring-ring",
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          {value.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {emptyLabel ?? "전체"}
            </span>
          )}
          {value.map((entry) => {
            const option = options.find((item) => item.value === entry);
            return (
              <span
                key={entry}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary"
              >
                {option?.label ?? entry}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-primary/20"
                  onClick={() => removeValue(entry)}
                  aria-label={`Remove ${option?.label ?? entry}`}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            placeholder={placeholder}
            className="flex-1 min-w-[120px] bg-transparent px-1 py-1 outline-none"
          />
        </div>
      </div>
      {isFocused && filteredOptions.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover text-sm shadow-lg">
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted"
              onClick={() => {
                addValue(option.value);
              }}
            >
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PeopleToggleList({
  label,
  value,
  onChange,
  options,
  synced,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  synced: boolean;
}) {
  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSelected = synced && value.length === 0;

  const toggleSelection = useCallback(
    (optionValue: string) => {
      if (selectedSet.has(optionValue)) {
        onChange(value.filter((entry) => entry !== optionValue));
      } else {
        onChange([...value, optionValue]);
      }
    },
    [onChange, selectedSet, value],
  );

  const handleSelectAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  if (!options.length) {
    return (
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          연결된 사용자가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        {!synced && (
          <span className="text-[11px] text-muted-foreground">
            고급 필터와 동기화되지 않음
          </span>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-2">
        <div className="flex flex-wrap gap-2">
          <TogglePill
            active={allSelected}
            variant={allSelected ? "active" : "inactive"}
            onClick={handleSelectAll}
          >
            전체
          </TogglePill>
          {options.map((option) => {
            const active = selectedSet.has(option.value);
            const variant = allSelected
              ? "muted"
              : active
                ? "active"
                : "inactive";
            return (
              <TogglePill
                key={option.value}
                active={active}
                variant={variant}
                onClick={() => toggleSelection(option.value)}
              >
                {option.label}
              </TogglePill>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TogglePill({
  active,
  children,
  onClick,
  variant,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  variant?: "active" | "inactive" | "muted";
}) {
  const resolvedVariant = variant ?? (active ? "active" : "inactive");
  const variantClass =
    resolvedVariant === "active"
      ? "border-primary bg-primary/10 text-primary"
      : resolvedVariant === "muted"
        ? "border-border/40 bg-muted/10 text-muted-foreground/60"
        : "border-border text-muted-foreground hover:bg-muted";

  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        variantClass,
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ActivityView({
  initialData,
  filterOptions,
  initialParams,
}: ActivityViewProps) {
  const router = useRouter();
  const perPageDefault =
    initialData.pageInfo.perPage ?? PER_PAGE_CHOICES[1] ?? 25;
  const initialState = useMemo(
    () => buildFilterState(initialParams, perPageDefault),
    [initialParams, perPageDefault],
  );

  const perPageChoices = useMemo(() => {
    const set = new Set(PER_PAGE_CHOICES);
    set.add(perPageDefault);
    return Array.from(set).sort((a, b) => a - b);
  }, [perPageDefault]);

  const [draft, setDraft] = useState<FilterState>(initialState);
  const [applied, setApplied] = useState<FilterState>(initialState);
  const [data, setData] = useState<ActivityListResult>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [openItemIds, setOpenItemIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [detailMap, setDetailMap] = useState<
    Record<string, ActivityItemDetail | null>
  >({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [jumpDate, setJumpDate] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const fetchControllerRef = useRef<AbortController | null>(null);
  const detailControllersRef = useRef(new Map<string, AbortController>());
  const requestCounterRef = useRef(0);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
      detailControllersRef.current.forEach((controller) => {
        controller.abort();
      });
      detailControllersRef.current.clear();
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(data.items.map((item) => item.id));

    setOpenItemIds((current) => {
      if (!current.size) {
        return current;
      }

      let changed = false;
      const next = new Set<string>();

      current.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
          const controller = detailControllersRef.current.get(id);
          if (controller) {
            controller.abort();
            detailControllersRef.current.delete(id);
          }
        }
      });

      return changed ? next : current;
    });

    setDetailMap((current) => {
      const entries = Object.entries(current);
      if (!entries.length) {
        return current;
      }

      let changed = false;
      const next: Record<string, ActivityItemDetail | null> = {};
      entries.forEach(([id, detail]) => {
        if (validIds.has(id)) {
          next[id] = detail;
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });

    setLoadingDetailIds((current) => {
      if (!current.size) {
        return current;
      }

      let changed = false;
      const next = new Set<string>();
      current.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [data.items]);

  const repositoryOptions = useMemo<MultiSelectOption[]>(
    () =>
      filterOptions.repositories.map((repository) => ({
        value: repository.id,
        label: repository.nameWithOwner ?? repository.name ?? repository.id,
        description: repository.name ?? repository.nameWithOwner ?? null,
      })),
    [filterOptions.repositories],
  );

  const labelOptions = useMemo<MultiSelectOption[]>(() => {
    if (!draft.repositoryIds.length) {
      return filterOptions.labels.map((label) => ({
        value: label.key,
        label: label.key,
        description: label.repositoryNameWithOwner,
      }));
    }

    const repoSet = new Set(draft.repositoryIds);
    return filterOptions.labels
      .filter((label) => repoSet.has(label.repositoryId))
      .map((label) => ({
        value: label.key,
        label: label.key,
        description: label.repositoryNameWithOwner,
      }));
  }, [draft.repositoryIds, filterOptions.labels]);

  useEffect(() => {
    if (!draft.repositoryIds.length) {
      return;
    }

    const allowed = new Set(labelOptions.map((label) => label.value));
    setDraft((current) => {
      const sanitized = current.labelKeys.filter((key) => allowed.has(key));
      if (sanitized.length === current.labelKeys.length) {
        return current;
      }

      return { ...current, labelKeys: sanitized };
    });
  }, [draft.repositoryIds, labelOptions]);

  const userOptions = useMemo<MultiSelectOption[]>(
    () =>
      filterOptions.users.map((user) => ({
        value: user.id,
        label: user.login?.length ? user.login : (user.name ?? user.id),
        description:
          user.name && user.login && user.name !== user.login
            ? user.name
            : null,
      })),
    [filterOptions.users],
  );

  const allowedUserIds = useMemo(
    () => new Set(filterOptions.users.map((user) => user.id)),
    [filterOptions.users],
  );

  useEffect(() => {
    setDraft((current) => sanitizePeopleIds(current, allowedUserIds));
    setApplied((current) => sanitizePeopleIds(current, allowedUserIds));
  }, [allowedUserIds]);

  const peopleState = useMemo(() => derivePeopleState(draft), [draft]);
  const peopleSelection = peopleState.selection;
  const peopleSynced = peopleState.isSynced;
  const handlePeopleChange = useCallback(
    (next: string[]) => {
      const filtered = next.filter((id) => allowedUserIds.has(id));
      setDraft((current) => applyPeopleSelection(current, filtered));
    },
    [allowedUserIds],
  );

  const showNotification = useCallback((message: string) => {
    setNotification(message);
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }
    notificationTimerRef.current = setTimeout(() => {
      setNotification(null);
    }, 3000);
  }, []);

  const fetchFeed = useCallback(
    async (
      nextFilters: FilterState,
      jumpToDate?: string | null,
      previousSync?: string | null,
    ) => {
      setIsLoading(true);
      setError(null);
      requestCounterRef.current += 1;
      const requestId = requestCounterRef.current;

      fetchControllerRef.current?.abort();
      const controller = new AbortController();
      fetchControllerRef.current = controller;

      const params = normalizeSearchParams(nextFilters, perPageDefault);
      if (jumpToDate) {
        params.set("jumpTo", jumpToDate);
      }

      try {
        const response = await fetch(`/api/activity?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to fetch activity data.");
        }
        const result = (await response.json()) as ActivityListResult;
        if (requestId !== requestCounterRef.current) {
          return;
        }

        setData(result);
        const nextState: FilterState = {
          ...nextFilters,
          page: result.pageInfo.page,
          perPage: result.pageInfo.perPage,
        };
        setApplied(nextState);
        setDraft(nextState);
        applyFiltersToQuery(router, nextState, perPageDefault);

        if (
          previousSync &&
          result.lastSyncCompletedAt &&
          previousSync === result.lastSyncCompletedAt
        ) {
          showNotification("Feed is already up to date.");
        }
      } catch (requestError) {
        if ((requestError as Error).name === "AbortError") {
          return;
        }
        setError("활동 데이터를 불러오지 못했습니다.");
        console.error(requestError);
      } finally {
        if (requestId === requestCounterRef.current) {
          setIsLoading(false);
        }
      }
    },
    [perPageDefault, router, showNotification],
  );

  const resetFilters = useCallback(() => {
    const base = buildFilterState({}, perPageDefault);
    setDraft(base);
  }, [perPageDefault]);

  const applyDraftFilters = useCallback(() => {
    const nextState = { ...draft, page: 1 };
    fetchFeed(nextState);
  }, [draft, fetchFeed]);

  const changePage = useCallback(
    (page: number) => {
      if (page < 1 || page === applied.page) {
        return;
      }

      const nextState = { ...applied, page };
      fetchFeed(nextState);
    },
    [applied, fetchFeed],
  );

  const changePerPage = useCallback(
    (perPage: number) => {
      const nextState = { ...applied, perPage, page: 1 };
      setDraft(nextState);
      fetchFeed(nextState);
    },
    [applied, fetchFeed],
  );

  const jumpToDate = useCallback(() => {
    if (!jumpDate) {
      return;
    }

    const trimmedZone = data.timezone?.trim();
    let effectiveJump = jumpDate;

    if (trimmedZone?.length) {
      const parsed = DateTime.fromISO(jumpDate, { zone: trimmedZone }).startOf(
        "day",
      );

      if (parsed.isValid) {
        effectiveJump = parsed.toISO({
          suppressMilliseconds: true,
          suppressSeconds: true,
          includeOffset: true,
        });
      }
    }

    fetchFeed({ ...applied }, effectiveJump);
  }, [applied, data.timezone, fetchFeed, jumpDate]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      return;
    }

    setLoadingDetailIds((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });

    const existing = detailControllersRef.current.get(id);
    existing?.abort();

    const controller = new AbortController();
    detailControllersRef.current.set(id, controller);

    try {
      const response = await fetch(`/api/activity/${id}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("Failed to fetch activity detail.");
      }

      const detail = (await response.json()) as ActivityItemDetail;
      setDetailMap((current) => ({
        ...current,
        [id]: detail,
      }));
    } catch (detailError) {
      if ((detailError as Error).name === "AbortError") {
        return;
      }
      console.error(detailError);
      setDetailMap((current) => ({
        ...current,
        [id]: null,
      }));
    } finally {
      detailControllersRef.current.delete(id);
      setLoadingDetailIds((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleSelectItem = useCallback(
    (id: string) => {
      setOpenItemIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
          const controller = detailControllersRef.current.get(id);
          controller?.abort();
          detailControllersRef.current.delete(id);
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(id)) {
              return loadings;
            }
            const updated = new Set(loadings);
            updated.delete(id);
            return updated;
          });
        } else {
          next.add(id);
          if (!detailMap[id] && !loadingDetailIds.has(id)) {
            void loadDetail(id);
          }
        }
        return next;
      });
    },
    [detailMap, loadDetail, loadingDetailIds],
  );

  useEffect(() => {
    openItemIds.forEach((id) => {
      if (!detailMap[id] && !loadingDetailIds.has(id)) {
        void loadDetail(id);
      }
    });
  }, [detailMap, loadDetail, loadingDetailIds, openItemIds]);

  const attentionSummary = useMemo(() => {
    const items = data.items;
    const totals = {
      unanswered_mentions: 0,
      review_requests_pending: 0,
      pr_open_too_long: 0,
      pr_inactive: 0,
      issue_backlog: 0,
      issue_stalled: 0,
    } satisfies Record<ActivityAttentionFilter, number>;

    items.forEach((item) => {
      if (item.attention.unansweredMention) totals.unanswered_mentions += 1;
      if (item.attention.reviewRequestPending)
        totals.review_requests_pending += 1;
      if (item.attention.staleOpenPr) totals.pr_open_too_long += 1;
      if (item.attention.idlePr) totals.pr_inactive += 1;
      if (item.attention.backlogIssue) totals.issue_backlog += 1;
      if (item.attention.stalledIssue) totals.issue_stalled += 1;
    });

    return totals;
  }, [data.items]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm">
        <h2 className="text-lg font-semibold">Activity Feed</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Last sync:{" "}
            {formatDateTime(data.lastSyncCompletedAt, data.timezone) ??
              "Not available"}
          </span>
          {notification && <span>{notification}</span>}
        </div>
      </div>
      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs font-medium uppercase text-muted-foreground">
                카테고리
              </Label>
              {(() => {
                const allSelected = draft.categories.length === 0;
                return (
                  <>
                    <TogglePill
                      active={allSelected}
                      variant={allSelected ? "active" : "inactive"}
                      onClick={() => {
                        setDraft((current) => {
                          const nextCategories: ActivityItemCategory[] = [];
                          let nextState: FilterState = {
                            ...current,
                            categories: nextCategories,
                          };
                          const peopleState = derivePeopleState(current);
                          if (peopleState.isSynced) {
                            nextState = applyPeopleSelection(
                              nextState,
                              peopleState.selection,
                              nextCategories,
                            );
                          }
                          return nextState;
                        });
                      }}
                    >
                      전체
                    </TogglePill>
                    {CATEGORY_OPTIONS.map((option) => {
                      const active = draft.categories.includes(option.value);
                      const variant = allSelected
                        ? "muted"
                        : active
                          ? "active"
                          : "inactive";
                      return (
                        <TogglePill
                          key={option.value}
                          active={active}
                          variant={variant}
                          onClick={() => {
                            setDraft((current) => {
                              const nextSet = new Set(current.categories);
                              if (nextSet.has(option.value)) {
                                nextSet.delete(option.value);
                              } else {
                                nextSet.add(option.value);
                              }
                              const nextCategories = Array.from(
                                nextSet,
                              ) as ActivityItemCategory[];
                              let nextState: FilterState = {
                                ...current,
                                categories: nextCategories,
                              };
                              const peopleState = derivePeopleState(current);
                              if (peopleState.isSynced) {
                                nextState = applyPeopleSelection(
                                  nextState,
                                  peopleState.selection,
                                  nextCategories,
                                );
                              }
                              return nextState;
                            });
                          }}
                        >
                          {option.label}
                        </TogglePill>
                      );
                    })}
                  </>
                );
              })()}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs font-medium uppercase text-muted-foreground">
                주의
              </Label>
              {(() => {
                const allSelected = draft.attention.length === 0;
                return (
                  <>
                    <TogglePill
                      active={allSelected}
                      variant={allSelected ? "active" : "inactive"}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          attention: [],
                        }));
                      }}
                    >
                      전체
                    </TogglePill>
                    {ATTENTION_OPTIONS.map((option) => {
                      const active = draft.attention.includes(option.value);
                      const variant = allSelected
                        ? "muted"
                        : active
                          ? "active"
                          : "inactive";
                      const count = attentionSummary[option.value] ?? 0;
                      return (
                        <TogglePill
                          key={option.value}
                          active={active}
                          variant={variant}
                          onClick={() => {
                            setDraft((current) => {
                              const nextSet = new Set(current.attention);
                              if (nextSet.has(option.value)) {
                                nextSet.delete(option.value);
                              } else {
                                nextSet.add(option.value);
                              }
                              return {
                                ...current,
                                attention: Array.from(nextSet),
                              };
                            });
                          }}
                        >
                          <span>{option.label}</span>
                          <span className="ml-1 text-muted-foreground">
                            ({count})
                          </span>
                        </TogglePill>
                      );
                    })}
                  </>
                );
              })()}
            </div>
            <PeopleToggleList
              label="사람"
              value={peopleSelection}
              onChange={handlePeopleChange}
              options={userOptions}
              synced={peopleSynced}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => setShowAdvancedFilters((value) => !value)}
              >
                {showAdvancedFilters ? "숨기기" : "고급 필터 보기"}
              </Button>
            </div>
          </div>
          {showAdvancedFilters && (
            <div className="space-y-6 rounded-md border border-border/60 bg-muted/10 p-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <MultiSelectInput
                  label="저장소"
                  placeholder="저장소 선택"
                  value={draft.repositoryIds}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      repositoryIds: next,
                    }))
                  }
                  options={repositoryOptions}
                  emptyLabel="모든 저장소"
                />
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    검색
                  </Label>
                  <Input
                    value={draft.search}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        search: event.target.value,
                      }))
                    }
                    placeholder="제목, 본문, 코멘트 검색"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        applyDraftFilters();
                      }
                    }}
                  />
                </div>
                <MultiSelectInput
                  label="라벨"
                  placeholder="repo:label"
                  value={draft.labelKeys}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, labelKeys: next }))
                  }
                  options={labelOptions}
                  emptyLabel="모든 라벨"
                />
                <MultiSelectInput
                  label="작성자"
                  placeholder="@user"
                  value={draft.authorIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, authorIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="모든 작성자"
                />
                <MultiSelectInput
                  label="담당자"
                  placeholder="@assignee"
                  value={draft.assigneeIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, assigneeIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="모든 담당자"
                />
                <MultiSelectInput
                  label="리뷰어"
                  placeholder="@reviewer"
                  value={draft.reviewerIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, reviewerIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="모든 리뷰어"
                />
                <MultiSelectInput
                  label="멘션된 사람"
                  placeholder="@mention"
                  value={draft.mentionedUserIds}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      mentionedUserIds: next,
                    }))
                  }
                  options={userOptions}
                  emptyLabel="모든 사용자"
                />
                <MultiSelectInput
                  label="코멘터"
                  placeholder="@commenter"
                  value={draft.commenterIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, commenterIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="모든 사용자"
                />
                <MultiSelectInput
                  label="리액션 남긴 사람"
                  placeholder="@reactor"
                  value={draft.reactorIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, reactorIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="모든 사용자"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs font-medium uppercase text-muted-foreground">
                  Status
                </Label>
                {STATUS_OPTIONS.map((option) => {
                  const active = draft.statuses.includes(option.value);
                  return (
                    <TogglePill
                      key={option.value}
                      active={active}
                      onClick={() => {
                        setDraft((current) => {
                          const nextSet = new Set(current.statuses);
                          if (nextSet.has(option.value)) {
                            nextSet.delete(option.value);
                          } else {
                            nextSet.add(option.value);
                          }
                          return {
                            ...current,
                            statuses: Array.from(nextSet),
                          };
                        });
                      }}
                    >
                      {option.label}
                    </TogglePill>
                  );
                })}
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase text-muted-foreground">
                    PR Thresholds (business days)
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.stalePrDays}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            stalePrDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.stalePrDays,
                            ),
                          },
                        }))
                      }
                      placeholder="Stale PRs"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.idlePrDays}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            idlePrDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.idlePrDays,
                            ),
                          },
                        }))
                      }
                      placeholder="Inactive PRs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase text-muted-foreground">
                    Issue Thresholds (business days)
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.backlogIssueDays}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            backlogIssueDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.backlogIssueDays,
                            ),
                          },
                        }))
                      }
                      placeholder="Backlog"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.stalledIssueDays}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            stalledIssueDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.stalledIssueDays,
                            ),
                          },
                        }))
                      }
                      placeholder="Stalled"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase text-muted-foreground">
                    Mentions / Reviews (business days)
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.unansweredMentionDays}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            unansweredMentionDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.unansweredMentionDays,
                            ),
                          },
                        }))
                      }
                      placeholder="Mentions"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.reviewRequestDays}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            reviewRequestDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.reviewRequestDays,
                            ),
                          },
                        }))
                      }
                      placeholder="Reviews"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={applyDraftFilters} disabled={isLoading}>
              필터 적용
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resetFilters}
              disabled={isLoading}
            >
              초기화
            </Button>
            <div className="flex items-center gap-2 md:ml-4">
              <Label className="text-xs font-medium uppercase text-muted-foreground">
                날짜 이동
              </Label>
              <Input
                type="date"
                value={jumpDate}
                onChange={(event) => setJumpDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    jumpToDate();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={jumpToDate}
                disabled={isLoading}
              >
                이동
              </Button>
            </div>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            페이지 {data.pageInfo.page} / {data.pageInfo.totalPages} (총{" "}
            {data.pageInfo.totalCount}건)
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase text-muted-foreground">
              Rows
            </span>
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={draft.perPage}
              onChange={(event) =>
                changePerPage(toPositiveInt(event.target.value, perPageDefault))
              }
            >
              {perPageChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-3">
          {isLoading && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">
              Loading activity feed...
            </div>
          )}
          {!isLoading && data.items.length === 0 && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">
              필터 조건에 맞는 활동이 없습니다.
            </div>
          )}
          {!isLoading &&
            data.items.map((item) => {
              const isSelected = openItemIds.has(item.id);
              const detail = detailMap[item.id] ?? undefined;
              const isDetailLoading = loadingDetailIds.has(item.id);
              const badges = buildAttentionBadges(item);
              const repositoryLabel = item.repository?.nameWithOwner ?? null;
              const numberLabel = item.number ? `#${item.number}` : null;
              const referenceLabel =
                repositoryLabel && numberLabel
                  ? `${repositoryLabel}${numberLabel}`
                  : (repositoryLabel ?? numberLabel);
              const iconInfo = resolveActivityIcon(item);
              const IconComponent = iconInfo.Icon;

              return (
                <div
                  key={item.id}
                  className="space-y-2 rounded-md border border-border bg-card/30 p-3"
                >
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left transition-colors",
                      isSelected
                        ? "text-foreground"
                        : "text-foreground hover:text-primary",
                    )}
                    onClick={() => handleSelectItem(item.id)}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <span
                          className={cn(
                            "inline-flex items-center justify-center rounded-full border border-border/60 bg-background p-1",
                            iconInfo.className,
                          )}
                          title={iconInfo.label}
                        >
                          <IconComponent className="h-4 w-4" />
                          <span className="sr-only">{iconInfo.label}</span>
                        </span>
                        {referenceLabel ? (
                          item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {referenceLabel}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">
                              {referenceLabel}
                            </span>
                          )
                        ) : null}
                        <span className="font-semibold text-foreground truncate">
                          {item.title ?? "Untitled"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {item.businessDaysOpen !== null &&
                          item.businessDaysOpen !== undefined && (
                            <span>
                              Age {differenceLabel(item.businessDaysOpen, "일")}
                            </span>
                          )}
                        {item.businessDaysIdle !== null &&
                          item.businessDaysIdle !== undefined && (
                            <span>
                              Idle{" "}
                              {differenceLabel(item.businessDaysIdle, "일")}
                            </span>
                          )}
                        {item.updatedAt && (
                          <span>
                            Updated {formatRelative(item.updatedAt) ?? "-"}
                            <span className="ml-1 text-muted-foreground">
                              •{" "}
                              {formatDateTime(item.updatedAt, data.timezone) ??
                                "-"}
                            </span>
                          </span>
                        )}
                        {item.author && (
                          <span>
                            Author {avatarFallback(item.author) ?? "-"}
                          </span>
                        )}
                        {badges.map((badge) => (
                          <span
                            key={badge}
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700"
                          >
                            {badge}
                          </span>
                        ))}
                        {item.labels.slice(0, 2).map((label) => (
                          <span
                            key={label.key}
                            className="rounded-md bg-muted px-2 py-0.5"
                          >
                            {label.key}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                  {isSelected && (
                    <div className="rounded-md border border-border bg-background p-4 text-sm">
                      {isDetailLoading ? (
                        <div className="text-muted-foreground">
                          Loading details...
                        </div>
                      ) : detail ? (
                        <div className="space-y-3">
                          <div className="whitespace-pre-wrap rounded-md border border-border bg-background px-4 py-3 text-sm">
                            {(() => {
                              if (!detail.body && !detail.bodyHtml) {
                                return "내용이 없습니다.";
                              }
                              if (detail.body?.trim().length) {
                                return detail.body;
                              }
                              if (detail.bodyHtml?.trim().length) {
                                const sanitized = stripHtml(
                                  detail.bodyHtml,
                                ).trim();
                                return sanitized.length
                                  ? sanitized
                                  : "내용이 없습니다.";
                              }
                              return "내용이 없습니다.";
                            })()}
                          </div>
                        </div>
                      ) : detail === null ? (
                        <div className="text-muted-foreground">
                          선택한 항목의 내용을 불러오지 못했습니다.
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          내용을 불러오는 중입니다.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        <div className="flex flex-col items-center gap-3 border-t border-border pt-3">
          <span className="text-sm text-muted-foreground">
            페이지 {data.pageInfo.page} / {data.pageInfo.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => changePage(data.pageInfo.page - 1)}
              disabled={isLoading || data.pageInfo.page <= 1}
            >
              이전
            </Button>
            <Button
              variant="outline"
              onClick={() => changePage(data.pageInfo.page + 1)}
              disabled={
                isLoading || data.pageInfo.page >= data.pageInfo.totalPages
              }
            >
              다음
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
