"use client";

import {
  Activity as ActivityIcon,
  AlertTriangle,
  ChevronDown,
  type LucideIcon,
  User,
  UserCheck,
} from "lucide-react";
import { DateTime } from "luxon";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ATTENTION_OPTIONS,
  ATTENTION_REQUIRED_VALUES,
} from "@/lib/activity/attention-options";
import { fetchActivityDetail } from "@/lib/activity/client";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import {
  buildFilterState,
  buildSavedFilterPayload,
  DEFAULT_THRESHOLD_VALUES,
  normalizeSearchParams,
} from "@/lib/activity/filter-state";
import type {
  ActivityFilterOptions,
  ActivityIssueBaseStatusFilter,
  ActivityIssuePriorityFilter,
  ActivityIssueWeightFilter,
  ActivityItem,
  ActivityItemType as ActivityItemCategory,
  ActivityItemDetail,
  ActivityLinkedIssueFilter,
  ActivityListParams,
  ActivityListResult,
  ActivityPullRequestStatusFilter,
  ActivitySavedFilter,
  IssueProjectStatus,
} from "@/lib/activity/types";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import { ActivityDetailOverlay } from "./activity/activity-detail-overlay";
import { ActivityListItemSummary } from "./activity/activity-list-item-summary";
import {
  ActivityCommentSection,
  formatDateOnly,
  formatDateTime,
  formatProjectField,
  ISSUE_STATUS_LABEL_MAP,
  ISSUE_STATUS_OPTIONS,
  ISSUE_STATUS_VALUE_SET,
  normalizeProjectFieldForComparison,
  PROJECT_FIELD_BADGE_CLASS,
  PROJECT_FIELD_LABELS,
  ProjectFieldEditor,
  type ProjectFieldKey,
  renderMarkdownHtml,
  resolveDetailBodyHtml,
  SOURCE_STATUS_KEYS,
} from "./activity/detail-shared";
import {
  buildActivityMetricEntries,
  formatRelative,
  resolveActivityIcon,
} from "./activity/shared";

type ActivityViewProps = {
  initialData: ActivityListResult;
  filterOptions: ActivityFilterOptions;
  initialParams: ActivityListParams;
  currentUserId: string | null;
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

type QuickFilterDefinition = {
  id: string;
  label: string;
  description: string;
  buildState: (perPage: number) => FilterState;
  icon: LucideIcon;
};

const CATEGORY_OPTIONS: Array<{ value: ActivityItemCategory; label: string }> =
  [
    { value: "discussion", label: "Discussion" },
    { value: "issue", label: "Issue" },
    { value: "pull_request", label: "Pull Request" },
  ];

const PR_STATUS_OPTIONS: Array<{
  value: ActivityPullRequestStatusFilter;
  label: string;
}> = [
  { value: "pr_open", label: "Open" },
  { value: "pr_merged", label: "Merged" },
  { value: "pr_closed", label: "Closed (Unmerged)" },
];

const ISSUE_BASE_STATUS_OPTIONS: Array<{
  value: ActivityIssueBaseStatusFilter;
  label: string;
}> = [
  { value: "issue_open", label: "Open" },
  { value: "issue_closed", label: "Closed" },
];

const PER_PAGE_CHOICES = [10, 25, 50];
const SAVED_FILTER_LIMIT_DEFAULT = 30;
const QUICK_FILTER_DUPLICATE_MESSAGE =
  "기본 빠른 필터와 동일한 설정은 저장할 수 없어요.";

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

function includesIssueCategory(categories: ActivityItemCategory[]) {
  return categories.length === 0 || categories.includes("issue");
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

function canonicalizeActivityParams(params: ActivityListParams) {
  const normalized: Record<string, unknown> = {};
  Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const value = params[key as keyof ActivityListParams];
      if (value === undefined) {
        return;
      }
      if (Array.isArray(value)) {
        normalized[key] = [...value].sort((a, b) =>
          String(a).localeCompare(String(b)),
        );
        return;
      }
      if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, number>)
          .filter(([, entryValue]) => entryValue !== undefined)
          .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
        normalized[key] = entries.reduce<Record<string, number>>(
          (accumulator, [entryKey, entryValue]) => {
            if (typeof entryValue === "number") {
              accumulator[entryKey] = entryValue;
            }
            return accumulator;
          },
          {},
        );
        return;
      }
      normalized[key] = value;
    });
  return JSON.stringify(normalized);
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

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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
  label: ReactNode;
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
      <Label className="text-xs font-semibold uppercase text-foreground">
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
            <span className="text-xs text-muted-foreground/70">
              {emptyLabel ?? "미적용"}
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
                <span className="text-xs text-muted-foreground/70">
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
  const optionValueSet = useMemo(
    () => new Set(options.map((option) => option.value)),
    [options],
  );
  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSelected = synced && value.length === 0;

  const toggleSelection = useCallback(
    (optionValue: string) => {
      if (selectedSet.has(optionValue)) {
        onChange(value.filter((entry) => entry !== optionValue));
      } else {
        const next = [...value, optionValue];
        const covered = new Set(
          next.filter((entry) => optionValueSet.has(entry)),
        );
        if (optionValueSet.size > 0 && covered.size === optionValueSet.size) {
          onChange([]);
          return;
        }
        onChange(next);
      }
    },
    [onChange, optionValueSet, selectedSet, value],
  );

  const handleSelectAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  if (!options.length) {
    return (
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-foreground">{label}</Label>
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground/80">
          연결된 사용자가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-foreground">{label}</Label>
        {!synced && (
          <span className="text-[11px] text-muted-foreground/70">
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
            미적용
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
        ? "border-border/60 bg-muted/15 text-muted-foreground/80 hover:border-border hover:bg-muted/25 hover:text-foreground"
        : "border-border text-foreground/80 hover:bg-muted";

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

function QuickFilterButton({
  active,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  const baseClass =
    "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const stateClass = active
    ? "bg-primary/15 text-primary shadow-sm hover:bg-primary/20 hover:shadow-md hover:-translate-y-0.5"
    : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground hover:shadow-md hover:-translate-y-0.5";

  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      className={cn(baseClass, stateClass)}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

type SavedFiltersManagerProps = {
  open: boolean;
  mode: "manage" | "save";
  filters: ActivitySavedFilter[];
  limit: number;
  canCreate: boolean;
  busyId: string | null;
  message: string | null;
  error: string | null;
  createName: string;
  createError: string | null;
  isCreating: boolean;
  onClose: () => void;
  onCreate: () => void;
  onCreateNameChange: (value: string) => void;
  onCancelCreate: () => void;
  onApply: (filter: ActivitySavedFilter) => void;
  onRename: (filter: ActivitySavedFilter, name: string) => Promise<void>;
  onReplace: (filter: ActivitySavedFilter) => Promise<void>;
  onDelete: (filter: ActivitySavedFilter) => Promise<void>;
  timezone: string | null;
  dateTimeFormat: DateTimeDisplayFormat;
};

const SavedFiltersManager = ({
  open,
  mode,
  filters,
  limit,
  canCreate,
  busyId,
  message,
  error,
  createName,
  createError,
  isCreating,
  onClose,
  onCreate,
  onCreateNameChange,
  onCancelCreate,
  onApply,
  onRename,
  onReplace,
  onDelete,
  timezone,
  dateTimeFormat,
}: SavedFiltersManagerProps) => {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedTimezone = timezone?.trim() ?? "";
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDrafts: Record<string, string> = {};
    filters.forEach((filter) => {
      nextDrafts[filter.id] = filter.name;
    });
    setDraftNames(nextDrafts);
  }, [filters, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode !== "save") {
      return;
    }
    const target = createInputRef.current;
    if (target) {
      target.focus();
      target.select();
    }
  }, [mode, open]);

  if (!open) {
    return null;
  }

  const handleNameChange = (filterId: string, nextName: string) => {
    setDraftNames((current) => ({
      ...current,
      [filterId]: nextName,
    }));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur">
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-3xl flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-2xl"
      >
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-foreground">필터 관리</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/80">
            <span>
              {filters.length} / {limit} 저장됨
            </span>
            <Button size="sm" variant="ghost" onClick={onClose}>
              닫기
            </Button>
          </div>
        </header>

        {message ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          {mode === "save" ? (
            <section className="mb-6 space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-semibold text-foreground">
                  현재 필터 저장
                </h4>
                <p className="text-xs text-muted-foreground/80">
                  Activity의 현재 조건을 저장해 두고 빠르게 불러올 수 있어요.
                </p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreate();
                }}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <Input
                  ref={createInputRef}
                  value={createName}
                  onChange={(event) => onCreateNameChange(event.target.value)}
                  maxLength={120}
                  placeholder="필터 이름"
                  className="h-9 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      !canCreate || !createName.trim().length || isCreating
                    }
                    className="h-8 px-3 text-xs"
                  >
                    저장
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onCancelCreate}
                    className="h-8 px-3 text-xs"
                  >
                    취소
                  </Button>
                </div>
              </form>
              {createError ? (
                <p className="text-xs text-rose-600">{createError}</p>
              ) : null}
              {!canCreate ? (
                <p className="text-xs text-amber-600">
                  최대 {limit}개의 필터를 저장할 수 있어요. 사용하지 않는 필터를
                  삭제해 주세요.
                </p>
              ) : null}
            </section>
          ) : null}
          {filters.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-6 text-center text-sm text-muted-foreground/80">
              저장된 필터가 아직 없어요. Activity에서 원하는 조건을 설정하고
              &ldquo;현재 필터 저장&rdquo;을 눌러 시작해 보세요.
            </div>
          ) : (
            <div className="space-y-4">
              {filters.map((filter) => {
                const draftName = draftNames[filter.id] ?? filter.name;
                const trimmed = draftName.trim();
                const isFilterBusy = busyId === filter.id;
                const canRename =
                  trimmed.length > 0 &&
                  trimmed !== filter.name &&
                  !isFilterBusy;
                const formattedUpdatedAt = formatDateTime(
                  filter.updatedAt,
                  timezone ?? undefined,
                  dateTimeFormat,
                );

                return (
                  <div
                    key={filter.id}
                    className="rounded-lg border border-border/60 bg-background px-4 py-3 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-1 flex-col gap-2">
                        <Input
                          value={draftName}
                          onChange={(event) =>
                            handleNameChange(filter.id, event.target.value)
                          }
                          maxLength={120}
                          className="h-9 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70">
                          <span title={timezoneTitle}>
                            마지막 수정: {formattedUpdatedAt}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={!canRename}
                          onClick={() => void onRename(filter, draftName)}
                          className="h-8 px-3 text-xs"
                        >
                          이름 저장
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void onReplace(filter)}
                          disabled={isFilterBusy}
                          className="h-8 px-3 text-xs"
                        >
                          현재 필터로 업데이트
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onApply(filter)}
                          className="h-8 px-3 text-xs"
                        >
                          필터 적용
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onDelete(filter)}
                          disabled={isFilterBusy}
                          className="h-8 px-3 text-xs text-rose-600 hover:text-rose-700"
                        >
                          삭제
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export function ActivityView({
  initialData,
  filterOptions,
  initialParams,
  currentUserId,
}: ActivityViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detailMap, setDetailMap] = useState<
    Record<string, ActivityItemDetail | null>
  >({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [updatingProjectFieldIds, setUpdatingProjectFieldIds] = useState<
    Set<string>
  >(() => new Set<string>());
  const [jumpDate, setJumpDate] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [savedFilters, setSavedFilters] = useState<ActivitySavedFilter[]>([]);
  const [savedFiltersLimit, setSavedFiltersLimit] = useState(
    SAVED_FILTER_LIMIT_DEFAULT,
  );
  const [savedFiltersLoading, setSavedFiltersLoading] = useState(false);
  const [savedFiltersError, setSavedFiltersError] = useState<string | null>(
    null,
  );
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState("");
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterError, setSaveFilterError] = useState<string | null>(null);
  const [isSavingFilter, setIsSavingFilter] = useState(false);
  const [filtersManagerOpen, setFiltersManagerOpen] = useState(false);
  const [filtersManagerMode, setFiltersManagerMode] = useState<
    "manage" | "save"
  >("manage");
  const [filtersManagerMessage, setFiltersManagerMessage] = useState<
    string | null
  >(null);
  const [filtersManagerError, setFiltersManagerError] = useState<string | null>(
    null,
  );
  const [filtersManagerBusyId, setFiltersManagerBusyId] = useState<
    string | null
  >(null);
  const savedFilterSelectId = useId();
  const trimmedTimezone = data.timezone?.trim() ?? "";
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;
  const formatDateTimeWithSettings = useCallback(
    (value: string | null | undefined) => {
      if (!value) {
        return null;
      }

      return formatDateTime(
        value,
        data.timezone ?? undefined,
        data.dateTimeFormat,
      );
    },
    [data.timezone, data.dateTimeFormat],
  );

  const fetchControllerRef = useRef<AbortController | null>(null);
  const detailControllersRef = useRef(new Map<string, AbortController>());
  const requestCounterRef = useRef(0);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const appliedQuickParamRef = useRef<string | null>(null);

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
    if (!filtersManagerOpen) {
      setFiltersManagerMessage(null);
      setFiltersManagerError(null);
      setFiltersManagerBusyId(null);
      setFiltersManagerMode("manage");
      setSaveFilterName("");
      setSaveFilterError(null);
    }
  }, [filtersManagerOpen]);

  useEffect(() => {
    const validIds = new Set(data.items.map((item) => item.id));

    if (openItemId && !validIds.has(openItemId)) {
      const controller = detailControllersRef.current.get(openItemId);
      if (controller) {
        controller.abort();
        detailControllersRef.current.delete(openItemId);
      }
      setOpenItemId(null);
    }

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
  }, [data.items, openItemId]);

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

  const issueTypeOptions = useMemo<MultiSelectOption[]>(() => {
    return filterOptions.issueTypes.map((issueType) => ({
      value: issueType.id,
      label: issueType.name ?? issueType.id,
    }));
  }, [filterOptions.issueTypes]);

  const milestoneOptions = useMemo<MultiSelectOption[]>(() => {
    return filterOptions.milestones.map((milestone) => {
      const parts: string[] = [];
      if (milestone.state) {
        parts.push(milestone.state);
      }
      if (milestone.dueOn) {
        const due = DateTime.fromISO(milestone.dueOn);
        if (due.isValid) {
          parts.push(due.toFormat("yyyy-MM-dd"));
        }
      }
      return {
        value: milestone.id,
        label: milestone.title ?? milestone.id,
        description: parts.length ? parts.join(" · ") : milestone.url,
      };
    });
  }, [filterOptions.milestones]);

  const issuePriorityOptions = useMemo<MultiSelectOption[]>(() => {
    const priorities = filterOptions.issuePriorities ?? [];
    return priorities.map((priority) => ({
      value: priority,
      label: priority,
    }));
  }, [filterOptions.issuePriorities]);

  const issueWeightOptions = useMemo<MultiSelectOption[]>(() => {
    const weights = filterOptions.issueWeights ?? [];
    return weights.map((weight) => ({
      value: weight,
      label: weight,
    }));
  }, [filterOptions.issueWeights]);

  const allowedIssueTypeIds = useMemo(
    () => new Set(issueTypeOptions.map((type) => type.value)),
    [issueTypeOptions],
  );

  const allowedMilestoneIds = useMemo(
    () => new Set(milestoneOptions.map((option) => option.value)),
    [milestoneOptions],
  );

  const allowedIssuePriorities = useMemo(
    () => new Set(issuePriorityOptions.map((option) => option.value)),
    [issuePriorityOptions],
  );

  const allowedIssueWeights = useMemo(
    () => new Set(issueWeightOptions.map((option) => option.value)),
    [issueWeightOptions],
  );

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

  useEffect(() => {
    setDraft((current) => {
      const sanitized = current.issueTypeIds.filter((id) =>
        allowedIssueTypeIds.has(id),
      );
      if (arraysShallowEqual(current.issueTypeIds, sanitized)) {
        return current;
      }
      return { ...current, issueTypeIds: sanitized };
    });
    setApplied((current) => {
      const sanitized = current.issueTypeIds.filter((id) =>
        allowedIssueTypeIds.has(id),
      );
      if (arraysShallowEqual(current.issueTypeIds, sanitized)) {
        return current;
      }
      return { ...current, issueTypeIds: sanitized };
    });
  }, [allowedIssueTypeIds]);

  useEffect(() => {
    setDraft((current) => {
      const sanitized = current.milestoneIds.filter((id) =>
        allowedMilestoneIds.has(id),
      );
      if (arraysShallowEqual(current.milestoneIds, sanitized)) {
        return current;
      }
      return { ...current, milestoneIds: sanitized };
    });
    setApplied((current) => {
      const sanitized = current.milestoneIds.filter((id) =>
        allowedMilestoneIds.has(id),
      );
      if (arraysShallowEqual(current.milestoneIds, sanitized)) {
        return current;
      }
      return { ...current, milestoneIds: sanitized };
    });
  }, [allowedMilestoneIds]);

  useEffect(() => {
    setDraft((current) => {
      const sanitized = current.issuePriorities.filter((value) =>
        allowedIssuePriorities.has(value),
      );
      if (arraysShallowEqual(current.issuePriorities, sanitized)) {
        return current;
      }
      return { ...current, issuePriorities: sanitized };
    });
    setApplied((current) => {
      const sanitized = current.issuePriorities.filter((value) =>
        allowedIssuePriorities.has(value),
      );
      if (arraysShallowEqual(current.issuePriorities, sanitized)) {
        return current;
      }
      return { ...current, issuePriorities: sanitized };
    });
  }, [allowedIssuePriorities]);

  useEffect(() => {
    setDraft((current) => {
      const sanitized = current.issueWeights.filter((value) =>
        allowedIssueWeights.has(value),
      );
      if (arraysShallowEqual(current.issueWeights, sanitized)) {
        return current;
      }
      return { ...current, issueWeights: sanitized };
    });
    setApplied((current) => {
      const sanitized = current.issueWeights.filter((value) =>
        allowedIssueWeights.has(value),
      );
      if (arraysShallowEqual(current.issueWeights, sanitized)) {
        return current;
      }
      return { ...current, issueWeights: sanitized };
    });
  }, [allowedIssueWeights]);

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

  const quickFilterDefinitions = useMemo<QuickFilterDefinition[]>(() => {
    const definitions: QuickFilterDefinition[] = [
      {
        id: "all_updates",
        label: "전체 활동",
        description: "모든 최신 활동을 훑어봅니다.",
        buildState: (perPage: number) => buildFilterState({}, perPage),
        icon: ActivityIcon,
      },
      {
        id: "attention_only",
        label: "확인 필요",
        description: '"주의 없음"을 제외한 항목만 확인합니다.',
        buildState: (perPage: number) => ({
          ...buildFilterState({}, perPage),
          attention: [...ATTENTION_REQUIRED_VALUES],
        }),
        icon: AlertTriangle,
      },
    ];

    if (currentUserId && allowedUserIds.has(currentUserId)) {
      const buildSelfState = (perPage: number) =>
        applyPeopleSelection(buildFilterState({}, perPage), [currentUserId]);

      definitions.push(
        {
          id: "my_updates",
          label: "내 활동",
          description: "나와 관련된 최신 활동을 확인합니다.",
          buildState: (perPage: number) => buildSelfState(perPage),
          icon: User,
        },
        {
          id: "my_attention",
          label: "내 확인 필요",
          description: "나에게 주의가 필요한 항목을 빠르게 살펴봅니다.",
          buildState: (perPage: number) => {
            const state = buildSelfState(perPage);
            return {
              ...state,
              attention: [...ATTENTION_REQUIRED_VALUES],
            };
          },
          icon: UserCheck,
        },
      );
    }

    return definitions;
  }, [allowedUserIds, currentUserId]);

  const quickFilterCanonicalSet = useMemo(() => {
    const keys = new Set<string>();
    quickFilterDefinitions.forEach((definition) => {
      const payload = buildSavedFilterPayload({
        ...definition.buildState(draft.perPage),
        page: 1,
      });
      keys.add(canonicalizeActivityParams(payload));
    });
    return keys;
  }, [draft.perPage, quickFilterDefinitions]);

  const canonicalDraftKey = useMemo(
    () =>
      canonicalizeActivityParams(
        buildSavedFilterPayload({ ...draft, page: 1 }),
      ),
    [draft],
  );

  const canonicalAppliedKey = useMemo(
    () =>
      canonicalizeActivityParams(
        buildSavedFilterPayload({ ...applied, page: 1 }),
      ),
    [applied],
  );

  const hasPendingChanges = useMemo(
    () => canonicalDraftKey !== canonicalAppliedKey,
    [canonicalAppliedKey, canonicalDraftKey],
  );

  const savedFilterCanonicalEntries = useMemo(
    () =>
      savedFilters.map((filter) => ({
        id: filter.id,
        key: canonicalizeActivityParams(
          buildSavedFilterPayload(
            buildFilterState(filter.payload, perPageDefault),
          ),
        ),
      })),
    [perPageDefault, savedFilters],
  );

  const activeQuickFilterId = useMemo(() => {
    for (const definition of quickFilterDefinitions) {
      const payload = buildSavedFilterPayload({
        ...definition.buildState(draft.perPage),
        page: 1,
      });
      if (canonicalizeActivityParams(payload) === canonicalDraftKey) {
        return definition.id;
      }
    }
    return null;
  }, [canonicalDraftKey, draft.perPage, quickFilterDefinitions]);

  useEffect(() => {
    const matched = savedFilterCanonicalEntries.find(
      (entry) => entry.key === canonicalDraftKey,
    );
    const nextId = matched ? matched.id : "";
    setSelectedSavedFilterId((currentId) =>
      currentId === nextId ? currentId : nextId,
    );
  }, [canonicalDraftKey, savedFilterCanonicalEntries]);

  const allowPullRequestStatuses = useMemo(
    () =>
      draft.categories.length === 0 ||
      draft.categories.includes("pull_request"),
    [draft.categories],
  );
  const allowIssueStatuses = useMemo(
    () => includesIssueCategory(draft.categories),
    [draft.categories],
  );

  const selectedIssueStatuses = useMemo(
    () => draft.statuses.filter((status) => ISSUE_STATUS_VALUE_SET.has(status)),
    [draft.statuses],
  );
  const issueStatusesAllSelected = selectedIssueStatuses.length === 0;
  const prStatusesAllSelected = draft.prStatuses.length === 0;
  const issueBaseStatusesAllSelected = draft.issueBaseStatuses.length === 0;
  const linkedIssueStatesAllSelected = draft.linkedIssueStates.length === 0;

  useEffect(() => {
    if (allowIssueStatuses) {
      return;
    }

    setDraft((current) => {
      const sanitizedStatuses = current.statuses.filter(
        (status) => !ISSUE_STATUS_VALUE_SET.has(status),
      );
      let next: FilterState = current;
      if (sanitizedStatuses.length !== current.statuses.length) {
        next = { ...next, statuses: sanitizedStatuses };
      }
      if (next.issueBaseStatuses.length > 0) {
        if (next === current) {
          next = { ...next };
        }
        next.issueBaseStatuses = [];
      }
      return next;
    });

    setApplied((current) => {
      const sanitizedStatuses = current.statuses.filter(
        (status) => !ISSUE_STATUS_VALUE_SET.has(status),
      );
      let next: FilterState = current;
      if (sanitizedStatuses.length !== current.statuses.length) {
        next = { ...next, statuses: sanitizedStatuses };
      }
      if (next.issueBaseStatuses.length > 0) {
        if (next === current) {
          next = { ...next };
        }
        next.issueBaseStatuses = [];
      }
      return next;
    });
  }, [allowIssueStatuses]);

  useEffect(() => {
    if (allowPullRequestStatuses) {
      return;
    }

    setDraft((current) => {
      if (current.prStatuses.length === 0) {
        return current;
      }
      return { ...current, prStatuses: [] };
    });

    setApplied((current) => {
      if (current.prStatuses.length === 0) {
        return current;
      }
      return { ...current, prStatuses: [] };
    });
  }, [allowPullRequestStatuses]);

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

  const loadSavedFilters = useCallback(async () => {
    setSavedFiltersLoading(true);
    setSavedFiltersError(null);
    try {
      const response = await fetch("/api/activity/filters");
      let payload: {
        filters?: ActivitySavedFilter[];
        limit?: number;
        message?: string;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        if (response.status === 401) {
          setSavedFilters([]);
          setSavedFiltersLimit(SAVED_FILTER_LIMIT_DEFAULT);
          setSelectedSavedFilterId("");
          return;
        }
        const message =
          typeof payload.message === "string"
            ? payload.message
            : "Unexpected error while loading saved filters.";
        throw new Error(message);
      }

      const filters = Array.isArray(payload.filters)
        ? (payload.filters as ActivitySavedFilter[])
        : [];
      const limit =
        typeof payload.limit === "number" && Number.isFinite(payload.limit)
          ? payload.limit
          : SAVED_FILTER_LIMIT_DEFAULT;

      setSavedFilters(filters);
      setSavedFiltersLimit(limit);
      setSelectedSavedFilterId((currentId) =>
        currentId && !filters.some((filter) => filter.id === currentId)
          ? ""
          : currentId,
      );
    } catch (loadError) {
      console.error(loadError);
      setSavedFiltersError("저장된 필터를 불러오지 못했어요.");
    } finally {
      setSavedFiltersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedFilters();
  }, [loadSavedFilters]);

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

  const handleApplyQuickFilter = useCallback(
    (definition: QuickFilterDefinition) => {
      const nextState = {
        ...definition.buildState(draft.perPage),
        page: 1,
      };
      const nextKey = canonicalizeActivityParams(
        buildSavedFilterPayload(nextState),
      );
      if (nextKey === canonicalDraftKey) {
        return;
      }

      setDraft(nextState);
      setApplied(nextState);
      setSelectedSavedFilterId("");
      setSaveFilterError(null);
      setJumpDate("");
      void fetchFeed(nextState);
    },
    [canonicalDraftKey, draft.perPage, fetchFeed],
  );

  useEffect(() => {
    if (!searchParams) {
      return;
    }

    const quickParam = searchParams.get("quick");
    if (!quickParam) {
      appliedQuickParamRef.current = null;
      return;
    }

    if (appliedQuickParamRef.current === quickParam) {
      return;
    }

    const definition = quickFilterDefinitions.find(
      (entry) => entry.id === quickParam,
    );

    const removeQuickParam = () => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("quick");
      appliedQuickParamRef.current = quickParam;
      router.replace(
        nextParams.toString().length
          ? `/dashboard/activity?${nextParams.toString()}`
          : "/dashboard/activity",
        { scroll: false },
      );
    };

    if (!definition) {
      removeQuickParam();
      return;
    }

    const nextState = {
      ...definition.buildState(draft.perPage),
      page: 1,
    };
    const nextKey = canonicalizeActivityParams(
      buildSavedFilterPayload(nextState),
    );

    if (nextKey === canonicalDraftKey) {
      removeQuickParam();
      return;
    }

    appliedQuickParamRef.current = quickParam;
    handleApplyQuickFilter(definition);
  }, [
    canonicalDraftKey,
    draft.perPage,
    handleApplyQuickFilter,
    quickFilterDefinitions,
    router,
    searchParams,
  ]);

  const applySavedFilter = useCallback(
    (filter: ActivitySavedFilter) => {
      const params: ActivityListParams = {
        ...filter.payload,
        page: 1,
      };
      const nextState = {
        ...buildFilterState(params, perPageDefault),
        page: 1,
      };
      setDraft(nextState);
      setApplied(nextState);
      setSelectedSavedFilterId(filter.id);
      setSaveFilterError(null);
      setJumpDate("");
      void fetchFeed(nextState);
    },
    [fetchFeed, perPageDefault],
  );

  const saveCurrentFilters = useCallback(async () => {
    setFiltersManagerMode("save");
    setSaveFilterError(null);

    if (savedFilters.length >= savedFiltersLimit) {
      setSaveFilterError(
        `필터는 최대 ${savedFiltersLimit}개까지 저장할 수 있어요. 사용하지 않는 필터를 삭제해 주세요.`,
      );
      return;
    }

    const trimmedName = saveFilterName.trim();
    if (!trimmedName.length) {
      setSaveFilterError("필터 이름을 입력해 주세요.");
      return;
    }

    const payload = buildSavedFilterPayload({ ...draft, page: 1 });
    if (quickFilterCanonicalSet.has(canonicalizeActivityParams(payload))) {
      setSaveFilterError(QUICK_FILTER_DUPLICATE_MESSAGE);
      return;
    }

    setIsSavingFilter(true);
    setFiltersManagerMessage(null);
    setFiltersManagerError(null);

    try {
      const response = await fetch("/api/activity/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, payload }),
      });

      let body: {
        filter?: ActivitySavedFilter;
        limit?: number;
        message?: string;
      } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        body = {};
      }

      if (!response.ok) {
        if (response.status === 400 && typeof body.message === "string") {
          setSaveFilterError(body.message);
        } else {
          setSaveFilterError("필터를 저장하지 못했어요.");
        }

        if (response.status === 400) {
          await loadSavedFilters();
        }

        return;
      }

      const newlySaved = body.filter as ActivitySavedFilter | undefined;
      const limit =
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : savedFiltersLimit;

      if (newlySaved) {
        setSavedFilters((current) => {
          const next = [
            newlySaved,
            ...current.filter((entry) => entry.id !== newlySaved.id),
          ];
          return next;
        });
        setSelectedSavedFilterId(newlySaved.id);
      } else {
        await loadSavedFilters();
      }

      setSavedFiltersLimit(limit);
      setSaveFilterName("");
      setFiltersManagerMode("manage");
      setFiltersManagerOpen(false);
      showNotification("필터를 저장했어요.");
    } catch (error) {
      console.error(error);
      setSaveFilterError("필터를 저장하지 못했어요.");
    } finally {
      setIsSavingFilter(false);
    }
  }, [
    draft,
    loadSavedFilters,
    saveFilterName,
    savedFilters,
    savedFiltersLimit,
    quickFilterCanonicalSet,
    showNotification,
  ]);

  const renameSavedFilter = useCallback(
    async (filter: ActivitySavedFilter, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed.length) {
        setFiltersManagerError("필터 이름을 입력해 주세요.");
        return;
      }

      setFiltersManagerBusyId(filter.id);
      setFiltersManagerMessage(null);
      setFiltersManagerError(null);

      try {
        const response = await fetch(
          `/api/activity/filters/${encodeURIComponent(filter.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: trimmed,
              expected: { updatedAt: filter.updatedAt },
            }),
          },
        );

        let body: { filter?: ActivitySavedFilter; message?: string } = {};
        try {
          body = (await response.json()) as typeof body;
        } catch {
          body = {};
        }

        const updated = body.filter as ActivitySavedFilter | undefined;

        if (!response.ok) {
          if (response.status === 409 && updated) {
            setSavedFilters((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setFiltersManagerError(
              body.message ?? "필터가 이미 변경되어 최신 정보를 불러왔어요.",
            );
            return;
          }

          if (response.status === 404) {
            await loadSavedFilters();
          }

          setFiltersManagerError(
            typeof body.message === "string"
              ? body.message
              : "필터 이름을 업데이트하지 못했어요.",
          );
          return;
        }

        if (updated) {
          setSavedFilters((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
          setSelectedSavedFilterId((currentId) =>
            currentId === updated.id ? updated.id : currentId,
          );
          setFiltersManagerMessage("필터 이름을 업데이트했어요.");
        } else {
          await loadSavedFilters();
        }
      } catch (error) {
        console.error(error);
        setFiltersManagerError("필터 이름을 업데이트하지 못했어요.");
      } finally {
        setFiltersManagerBusyId(null);
      }
    },
    [loadSavedFilters],
  );

  const replaceSavedFilter = useCallback(
    async (filter: ActivitySavedFilter) => {
      const payload = buildSavedFilterPayload({ ...draft, page: 1 });
      if (quickFilterCanonicalSet.has(canonicalizeActivityParams(payload))) {
        setFiltersManagerMessage(null);
        setFiltersManagerError(QUICK_FILTER_DUPLICATE_MESSAGE);
        return;
      }

      setFiltersManagerBusyId(filter.id);
      setFiltersManagerMessage(null);
      setFiltersManagerError(null);

      try {
        const response = await fetch(
          `/api/activity/filters/${encodeURIComponent(filter.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payload,
              expected: { updatedAt: filter.updatedAt },
            }),
          },
        );

        let body: { filter?: ActivitySavedFilter; message?: string } = {};
        try {
          body = (await response.json()) as typeof body;
        } catch {
          body = {};
        }

        const updated = body.filter as ActivitySavedFilter | undefined;

        if (!response.ok) {
          if (response.status === 409 && updated) {
            setSavedFilters((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setFiltersManagerError(
              body.message ?? "필터가 이미 변경되어 최신 정보를 불러왔어요.",
            );
            return;
          }

          if (response.status === 404) {
            await loadSavedFilters();
          }

          setFiltersManagerError(
            typeof body.message === "string"
              ? body.message
              : "필터를 업데이트하지 못했어요.",
          );
          return;
        }

        if (updated) {
          setSavedFilters((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
          setFiltersManagerMessage("필터 조건을 최신 설정으로 업데이트했어요.");
          setSelectedSavedFilterId((currentId) =>
            currentId === updated.id ? updated.id : currentId,
          );
        } else {
          await loadSavedFilters();
        }
      } catch (error) {
        console.error(error);
        setFiltersManagerError("필터를 업데이트하지 못했어요.");
      } finally {
        setFiltersManagerBusyId(null);
      }
    },
    [draft, loadSavedFilters, quickFilterCanonicalSet],
  );

  const deleteSavedFilter = useCallback(
    async (filter: ActivitySavedFilter) => {
      setFiltersManagerBusyId(filter.id);
      setFiltersManagerMessage(null);
      setFiltersManagerError(null);

      try {
        const response = await fetch(
          `/api/activity/filters/${encodeURIComponent(filter.id)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expected: { updatedAt: filter.updatedAt },
            }),
          },
        );

        let body: { filter?: ActivitySavedFilter; message?: string } = {};
        try {
          body = (await response.json()) as typeof body;
        } catch {
          body = {};
        }

        const returned = body.filter as ActivitySavedFilter | undefined;

        if (!response.ok) {
          if (response.status === 409 && returned) {
            setSavedFilters((current) =>
              current.map((item) =>
                item.id === returned.id ? returned : item,
              ),
            );
            setFiltersManagerError(
              body.message ?? "필터가 이미 변경되어 최신 정보를 불러왔어요.",
            );
            return;
          }

          if (response.status === 404) {
            await loadSavedFilters();
          }

          setFiltersManagerError(
            typeof body.message === "string"
              ? body.message
              : "필터를 삭제하지 못했어요.",
          );
          return;
        }

        const deletedId = returned?.id ?? filter.id;
        setSavedFilters((current) =>
          current.filter((item) => item.id !== deletedId),
        );
        setFiltersManagerMessage("필터를 삭제했어요.");
        setSelectedSavedFilterId((currentId) =>
          currentId === deletedId ? "" : currentId,
        );
      } catch (error) {
        console.error(error);
        setFiltersManagerError("필터를 삭제하지 못했어요.");
      } finally {
        setFiltersManagerBusyId(null);
      }
    },
    [loadSavedFilters],
  );

  const resetFilters = useCallback(() => {
    const base = buildFilterState({}, perPageDefault);
    setDraft(base);
  }, [perPageDefault]);

  const applyDraftFilters = useCallback(() => {
    if (!hasPendingChanges) {
      return;
    }
    const nextState = { ...draft, page: 1 };
    fetchFeed(nextState);
  }, [draft, fetchFeed, hasPendingChanges]);

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
      const detail = await fetchActivityDetail(id, {
        signal: controller.signal,
      });
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

  const handleUpdateIssueStatus = useCallback(
    async (item: ActivityItem, nextStatus: IssueProjectStatus) => {
      if (item.type !== "issue") {
        return;
      }

      const currentStatus = item.issueProjectStatus ?? "no_status";
      if (currentStatus === nextStatus && nextStatus !== "no_status") {
        return;
      }

      setUpdatingStatusIds((current) => {
        if (current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(item.id);
        return next;
      });

      try {
        const response = await fetch(
          `/api/activity/${encodeURIComponent(item.id)}/status`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              status: nextStatus,
              expectedStatus: currentStatus,
            }),
          },
        );

        const payload = (await response.json()) as {
          item?: ActivityItem;
          error?: string;
          todoStatus?: IssueProjectStatus;
        };

        if (!response.ok) {
          if (payload.item) {
            const conflictItem = payload.item;
            setData((current) => ({
              ...current,
              items: current.items.map((existing) =>
                existing.id === conflictItem.id ? conflictItem : existing,
              ),
            }));
            setDetailMap((current) => {
              const existing = current[conflictItem.id];
              if (!existing) {
                return current;
              }
              return {
                ...current,
                [conflictItem.id]: { ...existing, item: conflictItem },
              };
            });
          }

          let message = "상태를 변경하지 못했어요.";
          if (response.status === 409 && payload.todoStatus) {
            const todoLabel =
              ISSUE_STATUS_LABEL_MAP.get(payload.todoStatus) ??
              payload.todoStatus;
            message = `To-do 프로젝트 상태(${todoLabel})를 우선 적용하고 있어요.`;
          } else if (
            typeof payload.error === "string" &&
            payload.error.trim()
          ) {
            message = payload.error;
          }
          showNotification(message);
          return;
        }

        const updatedItem = payload.item ?? item;

        setData((current) => ({
          ...current,
          items: current.items.map((existing) =>
            existing.id === updatedItem.id ? updatedItem : existing,
          ),
        }));
        setDetailMap((current) => {
          const existing = current[updatedItem.id];
          if (!existing) {
            return current;
          }
          return {
            ...current,
            [updatedItem.id]: { ...existing, item: updatedItem },
          };
        });

        const label =
          ISSUE_STATUS_LABEL_MAP.get(
            updatedItem.issueProjectStatus ?? "no_status",
          ) ?? "No Status";
        showNotification(`상태를 ${label}로 업데이트했어요.`);
      } catch (statusError) {
        console.error(statusError);
        showNotification("상태를 변경하지 못했어요.");
      } finally {
        setUpdatingStatusIds((current) => {
          if (!current.has(item.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [showNotification],
  );

  const handleUpdateProjectField = useCallback(
    async (
      item: ActivityItem,
      field: ProjectFieldKey,
      nextValue: string | null,
    ) => {
      if (item.type !== "issue") {
        return false;
      }

      const currentValue = (() => {
        switch (field) {
          case "priority":
            return item.issueTodoProjectPriority;
          case "weight":
            return item.issueTodoProjectWeight;
          case "initiationOptions":
            return item.issueTodoProjectInitiationOptions;
          case "startDate":
            return item.issueTodoProjectStartDate;
          default:
            return null;
        }
      })();
      const currentUpdatedAt = (() => {
        switch (field) {
          case "priority":
            return item.issueTodoProjectPriorityUpdatedAt;
          case "weight":
            return item.issueTodoProjectWeightUpdatedAt;
          case "initiationOptions":
            return item.issueTodoProjectInitiationOptionsUpdatedAt;
          case "startDate":
            return item.issueTodoProjectStartDateUpdatedAt;
          default:
            return null;
        }
      })();

      const normalizedCurrent = normalizeProjectFieldForComparison(
        field,
        currentValue,
      );
      const normalizedNext = normalizeProjectFieldForComparison(
        field,
        nextValue,
      );

      if (normalizedCurrent === normalizedNext) {
        return true;
      }

      setUpdatingProjectFieldIds((current) => {
        if (current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(item.id);
        return next;
      });

      try {
        const payload = {
          [field]: nextValue,
          expected: {
            [field]: {
              value: currentValue,
              updatedAt: currentUpdatedAt,
            },
          },
        } as Record<string, unknown>;
        const response = await fetch(
          `/api/activity/${encodeURIComponent(item.id)}/project-fields`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const payloadResponse = (await response.json()) as {
          item?: ActivityItem;
          error?: string;
          todoStatus?: IssueProjectStatus;
        };

        if (!response.ok) {
          if (payloadResponse.item) {
            const conflictItem = payloadResponse.item;
            setData((current) => ({
              ...current,
              items: current.items.map((existing) =>
                existing.id === conflictItem.id ? conflictItem : existing,
              ),
            }));
            setDetailMap((current) => {
              const existing = current[conflictItem.id];
              if (!existing) {
                return current;
              }
              return {
                ...current,
                [conflictItem.id]: { ...existing, item: conflictItem },
              };
            });
          }

          let message = "값을 업데이트하지 못했어요.";
          if (response.status === 409 && payloadResponse.todoStatus) {
            const todoLabel =
              ISSUE_STATUS_LABEL_MAP.get(payloadResponse.todoStatus) ??
              payloadResponse.todoStatus;
            message = `To-do 프로젝트 상태(${todoLabel})를 우선 적용하고 있어요.`;
          } else if (
            typeof payloadResponse.error === "string" &&
            payloadResponse.error.trim()
          ) {
            message = payloadResponse.error;
          }
          showNotification(message);
          return false;
        }

        const updatedItem = payloadResponse.item ?? item;

        setData((current) => ({
          ...current,
          items: current.items.map((existing) =>
            existing.id === updatedItem.id ? updatedItem : existing,
          ),
        }));
        setDetailMap((current) => {
          const existing = current[updatedItem.id];
          if (!existing) {
            return current;
          }
          return {
            ...current,
            [updatedItem.id]: { ...existing, item: updatedItem },
          };
        });

        const label = PROJECT_FIELD_LABELS[field];
        showNotification(`${label} 값을 업데이트했어요.`);
        return true;
      } catch (error) {
        console.error(error);
        showNotification("값을 업데이트하지 못했어요.");
        return false;
      } finally {
        setUpdatingProjectFieldIds((current) => {
          if (!current.has(item.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [showNotification],
  );

  const handleSelectItem = useCallback(
    (id: string) => {
      setOpenItemId((current) => {
        if (current === id) {
          const controller = detailControllersRef.current.get(id);
          if (controller) {
            controller.abort();
            detailControllersRef.current.delete(id);
          }
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(id)) {
              return loadings;
            }
            const updated = new Set(loadings);
            updated.delete(id);
            return updated;
          });
          return null;
        }

        if (current) {
          const controller = detailControllersRef.current.get(current);
          if (controller) {
            controller.abort();
            detailControllersRef.current.delete(current);
          }
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(current)) {
              return loadings;
            }
            const updated = new Set(loadings);
            updated.delete(current);
            return updated;
          });
        }

        if (!detailMap[id] && !loadingDetailIds.has(id)) {
          void loadDetail(id);
        }

        return id;
      });
    },
    [detailMap, loadDetail, loadingDetailIds],
  );

  const handleItemKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, id: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelectItem(id);
      }
    },
    [handleSelectItem],
  );

  const handleCloseItem = useCallback(() => {
    setOpenItemId((current) => {
      if (!current) {
        return current;
      }
      const controller = detailControllersRef.current.get(current);
      if (controller) {
        controller.abort();
        detailControllersRef.current.delete(current);
      }
      setLoadingDetailIds((loadings) => {
        if (!loadings.has(current)) {
          return loadings;
        }
        const updated = new Set(loadings);
        updated.delete(current);
        return updated;
      });
      return null;
    });
  }, []);

  useEffect(() => {
    if (
      openItemId &&
      !detailMap[openItemId] &&
      !loadingDetailIds.has(openItemId)
    ) {
      void loadDetail(openItemId);
    }
  }, [detailMap, loadDetail, loadingDetailIds, openItemId]);

  const canSaveMoreFilters = savedFilters.length < savedFiltersLimit;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            모든 활동을 상세히 검색합니다.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
            Last sync:
            <span
              className="font-semibold text-foreground/80"
              title={timezoneTitle}
            >
              {formatDateTimeWithSettings(data.lastSyncCompletedAt) ??
                "Not available"}
            </span>
          </span>
          {notification ? (
            <span className="text-xs text-foreground/70">{notification}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {quickFilterDefinitions.length > 0 ? (
              quickFilterDefinitions.map((definition) => {
                const active = definition.id === activeQuickFilterId;
                return (
                  <QuickFilterButton
                    key={definition.id}
                    active={active}
                    label={definition.label}
                    description={definition.description}
                    icon={definition.icon}
                    onClick={() => handleApplyQuickFilter(definition)}
                  />
                );
              })
            ) : (
              <span className="text-xs text-muted-foreground/80">
                사용할 수 있는 빠른 필터가 없습니다.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Label htmlFor={savedFilterSelectId} className="sr-only">
                저장된 필터 선택
              </Label>
              <select
                id={savedFilterSelectId}
                value={selectedSavedFilterId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  if (!nextId) {
                    setSelectedSavedFilterId("");
                    return;
                  }
                  const target = savedFilters.find(
                    (filter) => filter.id === nextId,
                  );
                  if (target) {
                    applySavedFilter(target);
                  }
                }}
                disabled={savedFiltersLoading || savedFilters.length === 0}
                className={cn(
                  "h-10 min-w-[168px] appearance-none rounded-full border border-border/70 bg-background/80 px-4 pr-10 text-sm font-medium text-foreground shadow-sm transition",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <option value="">필터 선택</option>
                {savedFilters.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFiltersManagerMode("save");
                setFiltersManagerOpen(true);
                setFiltersManagerMessage(null);
                setFiltersManagerError(null);
                setFiltersManagerBusyId(null);
                setSaveFilterError(null);
                const selected = savedFilters.find(
                  (filter) => filter.id === selectedSavedFilterId,
                );
                setSaveFilterName(selected ? selected.name : "");
              }}
              disabled={!canSaveMoreFilters}
              className="h-10 rounded-full px-4 text-sm font-medium"
            >
              현재 필터 저장
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFiltersManagerMode("manage");
                setFiltersManagerOpen(true);
                setFiltersManagerMessage(null);
                setFiltersManagerError(null);
                setSaveFilterError(null);
              }}
              className="h-10 rounded-full px-4 text-sm font-medium text-foreground"
            >
              필터 관리
            </Button>
          </div>
        </div>
        {savedFiltersError || !canSaveMoreFilters ? (
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground/90">
            {savedFiltersError ? (
              <span className="text-rose-600">{savedFiltersError}</span>
            ) : null}
            {!canSaveMoreFilters ? (
              <span className="text-amber-700">
                최대 {savedFiltersLimit}개의 필터를 저장할 수 있어요. 사용하지
                않는 필터를 삭제해 주세요.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs font-semibold uppercase text-foreground">
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
                    미적용
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
                            let nextCategories = Array.from(
                              nextSet,
                            ) as ActivityItemCategory[];
                            if (
                              nextCategories.length === CATEGORY_OPTIONS.length
                            ) {
                              nextCategories = [];
                            }
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
                  {allowIssueStatuses && (
                    <>
                      <span
                        aria-hidden="true"
                        className="mx-2 h-4 border-l border-border/50"
                      />
                      <Label className="text-xs font-semibold text-foreground">
                        진행 상태
                      </Label>
                      <TogglePill
                        active={issueStatusesAllSelected}
                        variant={
                          issueStatusesAllSelected ? "active" : "inactive"
                        }
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            statuses: current.statuses.filter(
                              (status) => !ISSUE_STATUS_VALUE_SET.has(status),
                            ),
                          }));
                        }}
                      >
                        미적용
                      </TogglePill>
                      {ISSUE_STATUS_OPTIONS.map((option) => {
                        const active = draft.statuses.includes(option.value);
                        const variant = issueStatusesAllSelected
                          ? "muted"
                          : active
                            ? "active"
                            : "inactive";
                        return (
                          <TogglePill
                            key={`issue-status-${option.value}`}
                            active={active}
                            variant={variant}
                            onClick={() => {
                              setDraft((current) => {
                                const nextSet = new Set(current.statuses);
                                const hadIssueStatuses = current.statuses.some(
                                  (status) =>
                                    ISSUE_STATUS_VALUE_SET.has(status),
                                );
                                if (nextSet.has(option.value)) {
                                  nextSet.delete(option.value);
                                } else {
                                  nextSet.add(option.value);
                                }
                                let nextStatuses = Array.from(nextSet);
                                const issueStatuses = nextStatuses.filter(
                                  (status) =>
                                    ISSUE_STATUS_VALUE_SET.has(status),
                                );
                                if (
                                  issueStatuses.length ===
                                  ISSUE_STATUS_OPTIONS.length
                                ) {
                                  nextStatuses = nextStatuses.filter(
                                    (status) =>
                                      !ISSUE_STATUS_VALUE_SET.has(status),
                                  );
                                }
                                let nextState: FilterState = {
                                  ...current,
                                  statuses: nextStatuses,
                                };
                                const hasIssueStatuses = nextStatuses.some(
                                  (status) =>
                                    ISSUE_STATUS_VALUE_SET.has(status),
                                );
                                if (
                                  current.categories.length === 0 &&
                                  !hadIssueStatuses &&
                                  hasIssueStatuses
                                ) {
                                  const nextCategories: ActivityItemCategory[] =
                                    ["issue"];
                                  nextState = {
                                    ...nextState,
                                    categories: nextCategories,
                                  };
                                  const peopleState =
                                    derivePeopleState(current);
                                  if (peopleState.isSynced) {
                                    nextState = applyPeopleSelection(
                                      nextState,
                                      peopleState.selection,
                                      nextCategories,
                                    );
                                  }
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
                  )}
                </>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs font-semibold uppercase text-foreground">
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
                    미적용
                  </TogglePill>
                  {ATTENTION_OPTIONS.map((option) => {
                    const active = draft.attention.includes(option.value);
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
                            const nextSet = new Set(current.attention);
                            if (nextSet.has(option.value)) {
                              nextSet.delete(option.value);
                            } else {
                              nextSet.add(option.value);
                            }
                            const nextAttention = Array.from(nextSet);
                            if (
                              nextAttention.length === ATTENTION_OPTIONS.length
                            ) {
                              return { ...current, attention: [] };
                            }
                            return {
                              ...current,
                              attention: nextAttention,
                            };
                          });
                        }}
                      >
                        <span>{option.label}</span>
                      </TogglePill>
                    );
                  })}
                </>
              );
            })()}
          </div>
          <PeopleToggleList
            label="구성원"
            value={peopleSelection}
            onChange={handlePeopleChange}
            options={userOptions}
            synced={peopleSynced}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2"
              onClick={() => setShowAdvancedFilters((value) => !value)}
            >
              {showAdvancedFilters ? "숨기기" : "고급 필터 보기"}
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={applyDraftFilters}
                disabled={isLoading || !hasPendingChanges}
              >
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
            </div>
          </div>
          {showAdvancedFilters && (
            <div className="space-y-6 rounded-md border border-border/60 bg-muted/10 p-4">
              <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
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
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="라벨"
                  placeholder="repo:label"
                  value={draft.labelKeys}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, labelKeys: next }))
                  }
                  options={labelOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="마일스톤"
                  placeholder="마일스톤 선택"
                  value={draft.milestoneIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, milestoneIds: next }))
                  }
                  options={milestoneOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label={<span className="normal-case">이슈 Type</span>}
                  placeholder="이슈 Type 선택"
                  value={draft.issueTypeIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, issueTypeIds: next }))
                  }
                  options={issueTypeOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label={<span className="normal-case">이슈 Priority</span>}
                  placeholder="Priority 선택"
                  value={draft.issuePriorities}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      issuePriorities: next as ActivityIssuePriorityFilter[],
                    }))
                  }
                  options={issuePriorityOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label={<span className="normal-case">이슈 Weight</span>}
                  placeholder="Weight 선택"
                  value={draft.issueWeights}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      issueWeights: next as ActivityIssueWeightFilter[],
                    }))
                  }
                  options={issueWeightOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="작성자"
                  placeholder="@user"
                  value={draft.authorIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, authorIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="담당자"
                  placeholder="@assignee"
                  value={draft.assigneeIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, assigneeIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="리뷰어"
                  placeholder="@reviewer"
                  value={draft.reviewerIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, reviewerIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="멘션된 구성원"
                  placeholder="@mention"
                  value={draft.mentionedUserIds}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      mentionedUserIds: next,
                    }))
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="코멘터"
                  placeholder="@commenter"
                  value={draft.commenterIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, commenterIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="리액션 남긴 구성원"
                  placeholder="@reactor"
                  value={draft.reactorIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, reactorIds: next }))
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                />
                <div className="space-y-2 md:col-span-2 lg:col-span-2">
                  <Label className="text-xs font-semibold uppercase text-foreground">
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
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {allowPullRequestStatuses && (
                  <>
                    <Label className="text-xs font-semibold uppercase text-foreground">
                      PR 상태
                    </Label>
                    <TogglePill
                      active={prStatusesAllSelected}
                      variant={prStatusesAllSelected ? "active" : "inactive"}
                      onClick={() =>
                        setDraft((current) => ({ ...current, prStatuses: [] }))
                      }
                    >
                      미적용
                    </TogglePill>
                    {PR_STATUS_OPTIONS.map((option) => {
                      const active = draft.prStatuses.includes(option.value);
                      const variant = prStatusesAllSelected
                        ? "muted"
                        : active
                          ? "active"
                          : "inactive";
                      return (
                        <TogglePill
                          key={`advanced-pr-status-${option.value}`}
                          active={active}
                          variant={variant}
                          onClick={() => {
                            setDraft((current) => {
                              const nextSet = new Set(current.prStatuses);
                              if (nextSet.has(option.value)) {
                                nextSet.delete(option.value);
                              } else {
                                nextSet.add(option.value);
                              }
                              return {
                                ...current,
                                prStatuses: Array.from(nextSet),
                              };
                            });
                          }}
                        >
                          {option.label}
                        </TogglePill>
                      );
                    })}
                  </>
                )}
                {allowIssueStatuses && (
                  <>
                    <span
                      aria-hidden="true"
                      className="mx-2 h-4 border-l border-border/50"
                    />
                    <Label className="text-xs font-semibold uppercase text-foreground">
                      이슈 상태
                    </Label>
                    <TogglePill
                      active={issueBaseStatusesAllSelected}
                      variant={
                        issueBaseStatusesAllSelected ? "active" : "inactive"
                      }
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          issueBaseStatuses: [],
                        }))
                      }
                    >
                      미적용
                    </TogglePill>
                    {ISSUE_BASE_STATUS_OPTIONS.map((option) => {
                      const active = draft.issueBaseStatuses.includes(
                        option.value,
                      );
                      const variant = issueBaseStatusesAllSelected
                        ? "muted"
                        : active
                          ? "active"
                          : "inactive";
                      return (
                        <TogglePill
                          key={`advanced-issue-base-status-${option.value}`}
                          active={active}
                          variant={variant}
                          onClick={() => {
                            setDraft((current) => {
                              const nextSet = new Set(
                                current.issueBaseStatuses,
                              );
                              if (nextSet.has(option.value)) {
                                nextSet.delete(option.value);
                              } else {
                                nextSet.add(option.value);
                              }
                              return {
                                ...current,
                                issueBaseStatuses: Array.from(nextSet),
                              };
                            });
                          }}
                        >
                          {option.label}
                        </TogglePill>
                      );
                    })}
                  </>
                )}
                <span
                  aria-hidden="true"
                  className="mx-2 h-4 border-l border-border/50"
                />
                <Label className="text-xs font-semibold uppercase text-foreground">
                  이슈 연결
                </Label>
                <TogglePill
                  active={linkedIssueStatesAllSelected}
                  variant={linkedIssueStatesAllSelected ? "active" : "inactive"}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      linkedIssueStates: [],
                    }))
                  }
                >
                  미적용
                </TogglePill>
                {(
                  [
                    {
                      key: "has_sub" as ActivityLinkedIssueFilter,
                      label: "Parent 이슈",
                    },
                    {
                      key: "has_parent" as ActivityLinkedIssueFilter,
                      label: "Child 이슈",
                    },
                  ] as const
                ).map(({ key, label }) => {
                  const active = draft.linkedIssueStates.includes(key);
                  const variant = linkedIssueStatesAllSelected
                    ? "muted"
                    : active
                      ? "active"
                      : "inactive";
                  return (
                    <TogglePill
                      key={key}
                      active={active}
                      variant={variant}
                      onClick={() => {
                        setDraft((current) => {
                          const nextSet = new Set(current.linkedIssueStates);
                          if (nextSet.has(key)) {
                            nextSet.delete(key);
                          } else {
                            nextSet.add(key);
                          }
                          return {
                            ...current,
                            linkedIssueStates: Array.from(nextSet),
                          };
                        });
                      }}
                    >
                      {label}
                    </TogglePill>
                  );
                })}
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground">
                    이슈 임계값 (영업일): Backlog 정체, In Progress 정체
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
                      placeholder="Backlog 정체"
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
                      placeholder="In Progress 정체"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground">
                    PR 임계값 (영업일): PR 생성, PR 정체
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
                      placeholder="PR 생성"
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
                      placeholder="PR 정체"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-foreground">
                    리뷰/멘션 임계값 (영업일): 리뷰 무응답, 멘션 무응답
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
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
                      placeholder="리뷰 무응답"
                    />
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
                      placeholder="멘션 무응답"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-foreground">
            <span className="font-semibold">
              페이지 {data.pageInfo.page} / {data.pageInfo.totalPages} (총{" "}
              {data.pageInfo.totalCount}건)
            </span>
            <div className="flex items-center gap-2 text-xs uppercase text-foreground">
              <Label className="font-medium">날짜 이동</Label>
              <Input
                type="date"
                value={jumpDate}
                onChange={(event) => setJumpDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    jumpToDate();
                  }
                }}
                className="h-8 w-auto"
              />
              <Button
                type="button"
                variant="outline"
                onClick={jumpToDate}
                disabled={isLoading}
                className="h-8 px-3 text-xs"
              >
                이동
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase text-foreground">Rows</span>
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
            <div className="rounded-md border border-border bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground/80">
              Loading activity feed...
            </div>
          )}
          {!isLoading && data.items.length === 0 && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground/80">
              필터 조건에 맞는 활동이 없습니다.
            </div>
          )}
          {!isLoading && data.items.length > 0 && (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
              <div className="space-y-3">
                {data.items.map((item) => {
                  const isSelected = openItemId === item.id;
                  const detail = detailMap[item.id] ?? undefined;
                  const isDetailLoading = loadingDetailIds.has(item.id);
                  const badges = buildAttentionBadges(item);
                  if (item.hasParentIssue) {
                    badges.push("Child 이슈");
                  }
                  if (item.hasSubIssues) {
                    badges.push("Parent 이슈");
                  }
                  const repositoryLabel =
                    item.repository?.nameWithOwner ?? null;
                  const numberLabel = item.number ? `#${item.number}` : null;
                  const referenceLabel =
                    repositoryLabel && numberLabel
                      ? `${repositoryLabel}${numberLabel}`
                      : (repositoryLabel ?? numberLabel);
                  const iconInfo = resolveActivityIcon(item);
                  const isUpdatingStatus = updatingStatusIds.has(item.id);
                  const isUpdatingProjectFields = updatingProjectFieldIds.has(
                    item.id,
                  );
                  const currentIssueStatus =
                    item.issueProjectStatus ?? "no_status";
                  const statusSourceLabel =
                    item.issueProjectStatusSource === "todo_project"
                      ? "To-do 프로젝트"
                      : item.issueProjectStatusSource === "activity"
                        ? "Activity"
                        : "없음";
                  const todoStatusLabel = item.issueTodoProjectStatus
                    ? (ISSUE_STATUS_LABEL_MAP.get(
                        item.issueTodoProjectStatus,
                      ) ?? item.issueTodoProjectStatus)
                    : "-";
                  const todoPriorityLabel = formatProjectField(
                    item.issueTodoProjectPriority,
                  );
                  const todoWeightLabel = formatProjectField(
                    item.issueTodoProjectWeight,
                  );
                  const todoWeightTimestamp = formatDateTimeWithSettings(
                    item.issueTodoProjectWeightUpdatedAt,
                  );
                  const todoInitiationLabel = formatProjectField(
                    item.issueTodoProjectInitiationOptions,
                  );
                  const todoInitiationTimestamp = formatDateTimeWithSettings(
                    item.issueTodoProjectInitiationOptionsUpdatedAt,
                  );
                  const todoStartDateLabel = formatDateOnly(
                    item.issueTodoProjectStartDate,
                    data.timezone,
                  );
                  const todoStartDateTimestamp = formatDateTimeWithSettings(
                    item.issueTodoProjectStartDateUpdatedAt,
                  );
                  const canEditStatus =
                    item.type === "issue" && !item.issueProjectStatusLocked;
                  const sourceStatusTimes =
                    item.issueProjectStatusSource === "todo_project"
                      ? (detail?.todoStatusTimes ?? null)
                      : item.issueProjectStatusSource === "activity"
                        ? (detail?.activityStatusTimes ?? null)
                        : null;
                  const sourceStatusEntries = SOURCE_STATUS_KEYS.map(
                    (statusKey) => {
                      const label =
                        ISSUE_STATUS_LABEL_MAP.get(statusKey) ?? statusKey;
                      const value = sourceStatusTimes?.[statusKey] ?? null;
                      const formatted =
                        formatDateTimeWithSettings(value) ?? "-";
                      return { key: statusKey, label, value: formatted };
                    },
                  );
                  const metrics = buildActivityMetricEntries(item);
                  const updatedRelativeLabel = item.updatedAt
                    ? formatRelative(item.updatedAt)
                    : null;
                  const updatedAbsoluteLabel =
                    formatDateTimeWithSettings(item.updatedAt) ?? "-";

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "group rounded-md border bg-card p-3 transition focus-within:border-primary/60 focus-within:shadow-md focus-within:shadow-primary/10",
                        isSelected
                          ? "border-primary/60 shadow-md shadow-primary/10"
                          : "border-border/60 hover:border-primary/50 hover:bg-muted/20 hover:shadow-md hover:shadow-primary/10",
                      )}
                    >
                      {/* biome-ignore lint/a11y/useSemanticElements: Nested project field editors render buttons, so this container cannot be a <button>. */}
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={isSelected}
                        className={cn(
                          "w-full cursor-pointer text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          isSelected
                            ? "text-primary"
                            : "text-foreground group-hover:text-primary",
                        )}
                        onClick={() => handleSelectItem(item.id)}
                        onKeyDown={(event) => handleItemKeyDown(event, item.id)}
                      >
                        <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                          <ActivityListItemSummary
                            iconInfo={iconInfo}
                            referenceLabel={referenceLabel}
                            referenceUrl={item.url ?? undefined}
                            title={item.title}
                            metadata={
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
                                {metrics.map((metric) => (
                                  <span key={metric.key}>{metric.content}</span>
                                ))}
                                {item.author && (
                                  <span>
                                    작성자 {avatarFallback(item.author) ?? "-"}
                                  </span>
                                )}
                                {item.reviewers.length > 0 && (
                                  <span>
                                    리뷰어{" "}
                                    {item.reviewers
                                      .map(
                                        (reviewer) =>
                                          avatarFallback(reviewer) ??
                                          reviewer.id,
                                      )
                                      .join(", ")}
                                  </span>
                                )}
                                {item.issueType && (
                                  <span className="rounded-md bg-sky-100 px-2 py-0.5 text-sky-700">
                                    {item.issueType.name ?? item.issueType.id}
                                  </span>
                                )}
                                {item.milestone && (
                                  <span>
                                    Milestone{" "}
                                    {item.milestone.title ?? item.milestone.id}
                                  </span>
                                )}
                                {item.type === "issue" &&
                                  todoStatusLabel !== "-" && (
                                    <span className={PROJECT_FIELD_BADGE_CLASS}>
                                      {todoStatusLabel}
                                    </span>
                                  )}
                                {item.type === "issue" &&
                                  todoPriorityLabel !== "-" && (
                                    <span className={PROJECT_FIELD_BADGE_CLASS}>
                                      {todoPriorityLabel}
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
                            }
                          />
                          {item.updatedAt ? (
                            <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                              {updatedRelativeLabel ? (
                                <span className="font-medium text-foreground">
                                  {updatedRelativeLabel}
                                </span>
                              ) : null}
                              <span title={timezoneTitle}>
                                {updatedAbsoluteLabel ?? "-"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {isSelected && (
                        <ActivityDetailOverlay
                          item={item}
                          iconInfo={iconInfo}
                          badges={badges}
                          onClose={handleCloseItem}
                        >
                          {isDetailLoading ? (
                            <div className="text-muted-foreground/80">
                              Loading details...
                            </div>
                          ) : detail ? (
                            <div className="space-y-3">
                              {item.type === "issue" && (
                                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/70">
                                      <span className="flex items-center gap-1">
                                        <span className="text-muted-foreground/60">
                                          Source:
                                        </span>
                                        <span className="text-foreground">
                                          {statusSourceLabel}
                                        </span>
                                      </span>
                                      {sourceStatusEntries.map(
                                        ({ key, label, value }) => (
                                          <span
                                            key={`${item.id}-source-${key}`}
                                            className="flex items-center gap-1"
                                          >
                                            {label}:
                                            <span className="text-foreground">
                                              {value}
                                            </span>
                                          </span>
                                        ),
                                      )}
                                      {item.issueProjectStatusLocked && (
                                        <span className="text-amber-600">
                                          To-do 프로젝트 상태(
                                          {todoStatusLabel})로 잠겨 있어요.
                                        </span>
                                      )}
                                    </div>
                                    {(isUpdatingStatus ||
                                      isUpdatingProjectFields) && (
                                      <span className="text-muted-foreground/70">
                                        업데이트 중...
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {ISSUE_STATUS_OPTIONS.map((option) => {
                                      const optionStatus =
                                        option.value as IssueProjectStatus;
                                      const active =
                                        currentIssueStatus === optionStatus;
                                      return (
                                        <Button
                                          key={`status-action-${option.value}`}
                                          type="button"
                                          size="sm"
                                          variant={
                                            active ? "default" : "outline"
                                          }
                                          disabled={
                                            isUpdatingStatus ||
                                            isUpdatingProjectFields ||
                                            !canEditStatus
                                          }
                                          onClick={() =>
                                            handleUpdateIssueStatus(
                                              item,
                                              optionStatus,
                                            )
                                          }
                                        >
                                          {option.label}
                                        </Button>
                                      );
                                    })}
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-3 text-muted-foreground/80">
                                    <ProjectFieldEditor
                                      item={item}
                                      field="priority"
                                      label="Priority"
                                      rawValue={item.issueTodoProjectPriority}
                                      formattedValue={todoPriorityLabel}
                                      timestamp={null}
                                      disabled={
                                        item.issueProjectStatusLocked ||
                                        isUpdatingStatus
                                      }
                                      isUpdating={isUpdatingProjectFields}
                                      onSubmit={handleUpdateProjectField}
                                    />
                                    <ProjectFieldEditor
                                      item={item}
                                      field="weight"
                                      label="Weight"
                                      rawValue={item.issueTodoProjectWeight}
                                      formattedValue={todoWeightLabel}
                                      timestamp={todoWeightTimestamp}
                                      disabled={isUpdatingStatus}
                                      isUpdating={isUpdatingProjectFields}
                                      onSubmit={handleUpdateProjectField}
                                    />
                                    <ProjectFieldEditor
                                      item={item}
                                      field="initiationOptions"
                                      label="Initiation"
                                      rawValue={
                                        item.issueTodoProjectInitiationOptions
                                      }
                                      formattedValue={todoInitiationLabel}
                                      timestamp={todoInitiationTimestamp}
                                      disabled={
                                        item.issueProjectStatusLocked ||
                                        isUpdatingStatus
                                      }
                                      isUpdating={isUpdatingProjectFields}
                                      onSubmit={handleUpdateProjectField}
                                    />
                                    <ProjectFieldEditor
                                      item={item}
                                      field="startDate"
                                      label="Start"
                                      rawValue={item.issueTodoProjectStartDate}
                                      formattedValue={todoStartDateLabel}
                                      timestamp={todoStartDateTimestamp}
                                      disabled={
                                        item.issueProjectStatusLocked ||
                                        isUpdatingStatus
                                      }
                                      isUpdating={isUpdatingProjectFields}
                                      onSubmit={handleUpdateProjectField}
                                    />
                                  </div>
                                  {!item.issueProjectStatusLocked &&
                                    item.issueProjectStatusSource !==
                                      "activity" && (
                                      <p className="mt-2 text-muted-foreground/80">
                                        Activity 상태는 To-do 프로젝트가 No
                                        Status 또는 Todo일 때만 적용돼요.
                                      </p>
                                    )}
                                </div>
                              )}
                              <div className="rounded-md border border-border bg-background px-4 py-3 text-sm">
                                {(() => {
                                  const renderedBody =
                                    resolveDetailBodyHtml(detail);
                                  if (!renderedBody) {
                                    return (
                                      <div className="text-muted-foreground/80">
                                        내용이 없습니다.
                                      </div>
                                    );
                                  }
                                  const content =
                                    renderMarkdownHtml(renderedBody);
                                  if (!content) {
                                    return (
                                      <div className="text-muted-foreground/80">
                                        내용을 표시할 수 없습니다.
                                      </div>
                                    );
                                  }
                                  return (
                                    <div className="space-y-4 leading-relaxed [&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.user-mention]:font-semibold">
                                      {content}
                                    </div>
                                  );
                                })()}
                              </div>
                              <ActivityCommentSection
                                comments={detail.comments}
                                timezone={data.timezone}
                                dateTimeFormat={data.dateTimeFormat}
                              />
                              {(detail.parentIssues.length > 0 ||
                                detail.subIssues.length > 0) && (
                                <div className="space-y-4 text-xs">
                                  {detail.parentIssues.length > 0 && (
                                    <div>
                                      <h4 className="font-semibold text-muted-foreground/85">
                                        상위 이슈
                                      </h4>
                                      <ul className="mt-1 space-y-1">
                                        {detail.parentIssues.map((linked) => {
                                          const referenceParts: string[] = [];
                                          if (linked.repositoryNameWithOwner) {
                                            referenceParts.push(
                                              linked.repositoryNameWithOwner,
                                            );
                                          }
                                          if (
                                            typeof linked.number === "number"
                                          ) {
                                            referenceParts.push(
                                              `#${linked.number}`,
                                            );
                                          }
                                          const referenceLabel =
                                            referenceParts.length > 0
                                              ? referenceParts.join("")
                                              : null;
                                          const titleLabel =
                                            linked.title ??
                                            linked.state ??
                                            linked.id;
                                          const displayLabel = referenceLabel
                                            ? `${referenceLabel}${titleLabel ? ` — ${titleLabel}` : ""}`
                                            : titleLabel;
                                          return (
                                            <li key={`parent-${linked.id}`}>
                                              {linked.url ? (
                                                <a
                                                  href={linked.url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="text-primary hover:underline"
                                                >
                                                  {displayLabel ?? linked.id}
                                                </a>
                                              ) : (
                                                <span>
                                                  {displayLabel ?? linked.id}
                                                </span>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  )}
                                  {detail.subIssues.length > 0 && (
                                    <div>
                                      <h4 className="font-semibold text-muted-foreground/85">
                                        하위 이슈
                                      </h4>
                                      <ul className="mt-1 space-y-1">
                                        {detail.subIssues.map((linked) => {
                                          const referenceParts: string[] = [];
                                          if (linked.repositoryNameWithOwner) {
                                            referenceParts.push(
                                              linked.repositoryNameWithOwner,
                                            );
                                          }
                                          if (
                                            typeof linked.number === "number"
                                          ) {
                                            referenceParts.push(
                                              `#${linked.number}`,
                                            );
                                          }
                                          const referenceLabel =
                                            referenceParts.length > 0
                                              ? referenceParts.join("")
                                              : null;
                                          const titleLabel =
                                            linked.title ??
                                            linked.state ??
                                            linked.id;
                                          const displayLabel = referenceLabel
                                            ? `${referenceLabel}${titleLabel ? ` — ${titleLabel}` : ""}`
                                            : titleLabel;
                                          return (
                                            <li key={`sub-${linked.id}`}>
                                              {linked.url ? (
                                                <a
                                                  href={linked.url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="text-primary hover:underline"
                                                >
                                                  {displayLabel ?? linked.id}
                                                </a>
                                              ) : (
                                                <span>
                                                  {displayLabel ?? linked.id}
                                                </span>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : detail === null ? (
                            <div className="text-muted-foreground/80">
                              선택한 항목의 내용을 불러오지 못했습니다.
                            </div>
                          ) : (
                            <div className="text-muted-foreground/80">
                              내용을 불러오는 중입니다.
                            </div>
                          )}
                        </ActivityDetailOverlay>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-3 border-t border-border pt-3">
          <span className="text-sm font-semibold text-foreground">
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
      {filtersManagerOpen ? (
        <SavedFiltersManager
          open={filtersManagerOpen}
          mode={filtersManagerMode}
          filters={savedFilters}
          limit={savedFiltersLimit}
          canCreate={canSaveMoreFilters}
          busyId={filtersManagerBusyId}
          message={filtersManagerMessage}
          error={filtersManagerError}
          createName={saveFilterName}
          createError={saveFilterError}
          isCreating={isSavingFilter}
          onClose={() => setFiltersManagerOpen(false)}
          onCreate={() => void saveCurrentFilters()}
          onCreateNameChange={(value) => setSaveFilterName(value)}
          onCancelCreate={() => setFiltersManagerOpen(false)}
          onApply={applySavedFilter}
          onRename={renameSavedFilter}
          onReplace={replaceSavedFilter}
          onDelete={deleteSavedFilter}
          timezone={data.timezone ?? null}
          dateTimeFormat={data.dateTimeFormat}
        />
      ) : null}
    </div>
  );
}
