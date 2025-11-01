"use client";

import {
  Activity as ActivityIcon,
  AlertTriangle,
  Bot,
  ChevronDown,
  Info,
  ListTodo,
  type LucideIcon,
  User,
  UserCheck,
} from "lucide-react";
import { DateTime } from "luxon";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Fragment,
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
  ActivityAttentionFilter,
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
  ActivityMentionWait,
  ActivityPullRequestStatusFilter,
  ActivitySavedFilter,
  ActivityStatusFilter,
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
  MentionOverrideControls,
  normalizeProjectFieldForComparison,
  PROJECT_FIELD_BADGE_CLASS,
  PROJECT_FIELD_LABELS,
  ProjectFieldEditor,
  type ProjectFieldKey,
  ReactionSummaryList,
  renderMarkdownHtml,
  resolveDetailBodyHtml,
  SOURCE_STATUS_KEYS,
} from "./activity/detail-shared";
import {
  buildActivityMetricEntries,
  buildLinkedIssueSummary,
  buildLinkedPullRequestSummary,
  formatRelative,
  renderLinkedReferenceInline,
  resolveActivityIcon,
} from "./activity/shared";

type ActivityViewProps = {
  initialData: ActivityListResult;
  filterOptions: ActivityFilterOptions;
  initialParams: ActivityListParams;
  currentUserId: string | null;
  currentUserIsAdmin: boolean;
};

const ATTENTION_TOOLTIPS: Partial<Record<ActivityAttentionFilter, string>> = {
  issue_backlog:
    "구성원 선택 시, 구성원이 이슈의 해당 저장소 책임자인 항목만 표시합니다.",
  issue_stalled:
    "구성원 선택 시, 구성원이 이슈의 담당자이거나, 담당자 미정 시 해당 저장소 책임자이거나, 담당자/저장소 미지정 시 작성자인 항목만 표시합니다.",
  pr_open_too_long:
    "구성원 선택 시, 구성원이 PR의 작성자, 담당자, 리뷰어, 또는 저장소 책임자인 항목만 표시합니다.",
  pr_inactive:
    "구성원 선택 시, 구성원이 PR의 작성자, 담당자, 리뷰어, 또는 저장소 책임자인 항목만 표시합니다. octoaide가 남긴 활동은 업데이트로 간주하지 않습니다.",
  review_requests_pending:
    "구성원 선택 시, 구성원이 리뷰 요청을 받은 항목만 표시합니다.",
  unanswered_mentions:
    "구성원 선택 시, 구성원이 멘션된 구성원인 항목만 표시합니다.",
};

type PeopleRoleKey =
  | "authorIds"
  | "assigneeIds"
  | "reviewerIds"
  | "mentionedUserIds"
  | "commenterIds"
  | "reactorIds"
  | "maintainerIds";

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
  "maintainerIds",
];

const ATTENTION_ROLE_RULES: Record<
  ActivityAttentionFilter,
  {
    applied: PeopleRoleKey[];
    optional: PeopleRoleKey[];
    cleared: PeopleRoleKey[];
  }
> = {
  no_attention: { applied: [], optional: [], cleared: [] },
  issue_backlog: {
    applied: ["maintainerIds"],
    optional: [],
    cleared: [
      "authorIds",
      "assigneeIds",
      "reviewerIds",
      "mentionedUserIds",
      "commenterIds",
      "reactorIds",
    ],
  },
  issue_stalled: {
    applied: ["assigneeIds"],
    optional: ["authorIds"],
    cleared: [
      "reviewerIds",
      "mentionedUserIds",
      "commenterIds",
      "reactorIds",
      "maintainerIds",
    ],
  },
  pr_open_too_long: {
    applied: ["authorIds", "assigneeIds", "reviewerIds", "maintainerIds"],
    optional: [],
    cleared: ["mentionedUserIds", "commenterIds", "reactorIds"],
  },
  pr_inactive: {
    applied: ["authorIds", "assigneeIds", "reviewerIds", "maintainerIds"],
    optional: [],
    cleared: ["mentionedUserIds", "commenterIds", "reactorIds"],
  },
  review_requests_pending: {
    applied: ["reviewerIds"],
    optional: [],
    cleared: [
      "authorIds",
      "assigneeIds",
      "mentionedUserIds",
      "commenterIds",
      "reactorIds",
      "maintainerIds",
    ],
  },
  unanswered_mentions: {
    applied: ["mentionedUserIds"],
    optional: [],
    cleared: [
      "authorIds",
      "assigneeIds",
      "reviewerIds",
      "commenterIds",
      "reactorIds",
      "maintainerIds",
    ],
  },
};

function getPeopleRoleValues(
  state: FilterState,
  role: PeopleRoleKey,
): string[] {
  const mapValues = state.peopleFilters?.[role];
  if (Array.isArray(mapValues)) {
    return mapValues;
  }
  switch (role) {
    case "authorIds":
      return state.authorIds ?? [];
    case "assigneeIds":
      return state.assigneeIds ?? [];
    case "reviewerIds":
      return state.reviewerIds ?? [];
    case "mentionedUserIds":
      return state.mentionedUserIds ?? [];
    case "commenterIds":
      return state.commenterIds ?? [];
    case "reactorIds":
      return state.reactorIds ?? [];
    case "maintainerIds":
      return state.maintainerIds ?? [];
    default:
      return [];
  }
}

function setOptionalPersonValues(
  state: FilterState,
  role: PeopleRoleKey,
  values: string[],
): FilterState {
  const unique = Array.from(new Set(values));
  const currentMap = state.optionalPersonIds ?? {};
  const hasRole = role in currentMap;
  const currentValues = currentMap[role] ?? [];
  if (arraysShallowEqual(currentValues, unique)) {
    if (unique.length === 0 && !hasRole) {
      return state;
    }
    if (unique.length === 0 && hasRole) {
      const nextOptional = { ...currentMap };
      delete nextOptional[role];
      return {
        ...state,
        optionalPersonIds: nextOptional,
      };
    }
    return state;
  }

  const nextOptional = { ...currentMap };
  if (unique.length > 0) {
    nextOptional[role] = unique;
  } else if (hasRole) {
    delete nextOptional[role];
  } else {
    return state;
  }

  return {
    ...state,
    optionalPersonIds: nextOptional,
  };
}

function setPeopleRoleValues(
  state: FilterState,
  role: PeopleRoleKey,
  values: string[],
): FilterState {
  const normalized = Array.from(new Set(values));
  if (arraysShallowEqual(getPeopleRoleValues(state, role), normalized)) {
    return setOptionalPersonValues(state, role, []);
  }

  const shouldClearTaskMode =
    state.taskMode === "my_todo" &&
    (role === "authorIds" ||
      role === "assigneeIds" ||
      role === "reviewerIds" ||
      role === "mentionedUserIds" ||
      role === "maintainerIds");

  const clonedValues = [...normalized];
  const next: FilterState = {
    ...state,
    peopleFilters: {
      ...state.peopleFilters,
      [role]: clonedValues,
    },
  };

  switch (role) {
    case "authorIds":
      next.authorIds = clonedValues;
      break;
    case "assigneeIds":
      next.assigneeIds = clonedValues;
      break;
    case "reviewerIds":
      next.reviewerIds = clonedValues;
      break;
    case "mentionedUserIds":
      next.mentionedUserIds = clonedValues;
      break;
    case "commenterIds":
      next.commenterIds = clonedValues;
      break;
    case "reactorIds":
      next.reactorIds = clonedValues;
      break;
    case "maintainerIds":
      next.maintainerIds = clonedValues;
      break;
  }

  const withOptionalCleared = setOptionalPersonValues(next, role, []);
  if (shouldClearTaskMode && withOptionalCleared.taskMode === "my_todo") {
    return { ...withOptionalCleared, taskMode: null };
  }
  return withOptionalCleared;
}

function clearPeopleRoleValues(state: FilterState, role: PeopleRoleKey) {
  if (getPeopleRoleValues(state, role).length > 0) {
    return setPeopleRoleValues(state, role, []);
  }
  return setOptionalPersonValues(state, role, []);
}

function updatePeopleRoleValues(
  state: FilterState,
  role: PeopleRoleKey,
  values: string[],
): FilterState {
  const nextState = setPeopleRoleValues(state, role, values);
  return syncPeopleFilters(nextState);
}

function updateOptionalPersonValues(
  state: FilterState,
  role: PeopleRoleKey,
  values: string[],
): FilterState {
  const nextState = setOptionalPersonValues(state, role, values);
  return syncPeopleFilters(nextState);
}

function removeMentionRole(state: FilterState): FilterState {
  let nextState = setPeopleRoleValues(state, "mentionedUserIds", []);
  nextState = setOptionalPersonValues(nextState, "mentionedUserIds", []);
  if (
    nextState.optionalPersonIds &&
    "mentionedUserIds" in nextState.optionalPersonIds
  ) {
    const { mentionedUserIds: _omit, ...rest } = nextState.optionalPersonIds;
    nextState = {
      ...nextState,
      optionalPersonIds: rest,
    };
  }
  return syncPeopleFilters(nextState);
}

function hasActiveAttentionFilters(state: FilterState): boolean {
  return state.attention.some((value) => value !== "no_attention");
}

function collectPeopleSelectionFromRoles(state: FilterState): string[] {
  const seen = new Set<string>();
  const collected: string[] = [];
  PEOPLE_ROLE_KEYS.forEach((role) => {
    const values = getPeopleRoleValues(state, role);
    values.forEach((value) => {
      if (!seen.has(value)) {
        seen.add(value);
        collected.push(value);
      }
    });
  });
  return collected;
}

function syncPeopleSelectionFromRoles(state: FilterState): FilterState {
  const peopleState = derivePeopleState(state);
  const shouldClearOptional = !isOptionalPeopleEmpty(state);

  if (!peopleState.isSynced) {
    let nextState: FilterState = state;
    let changed = false;
    if (nextState.peopleSelection.length > 0) {
      nextState = {
        ...nextState,
        peopleSelection: [],
      };
      changed = true;
    }
    if (shouldClearOptional) {
      nextState = { ...nextState, optionalPersonIds: {} };
      changed = true;
    }
    return changed ? nextState : state;
  }

  const union = collectPeopleSelectionFromRoles(state);
  const selectionMatches = arraysShallowEqual(state.peopleSelection, union);

  if (selectionMatches && !shouldClearOptional) {
    return state;
  }

  let nextState: FilterState = state;
  if (!selectionMatches) {
    nextState = {
      ...nextState,
      peopleSelection: union,
    };
  }
  if (shouldClearOptional) {
    nextState = { ...nextState, optionalPersonIds: {} };
  }
  return nextState;
}

function syncPeopleFiltersWithAttention(state: FilterState): FilterState {
  if (!hasActiveAttentionFilters(state)) {
    return state;
  }

  const selection = Array.from(new Set(state.peopleSelection ?? []));

  if (selection.length === 0) {
    let nextState = state;
    PEOPLE_ROLE_KEYS.forEach((role) => {
      nextState = setPeopleRoleValues(nextState, role, []);
    });
    PEOPLE_ROLE_KEYS.forEach((role) => {
      nextState = setOptionalPersonValues(nextState, role, []);
    });
    return nextState;
  }

  const attentions = state.attention.filter(
    (value) => value !== "no_attention",
  );
  const appliedRoles = new Set<PeopleRoleKey>();
  const optionalRoles = new Set<PeopleRoleKey>();

  if (attentions.length === 0) {
    for (const role of getPeopleRoleTargets(state.categories)) {
      appliedRoles.add(role);
    }
  } else {
    type RoleState = {
      applied: boolean;
      optional: boolean;
      cleared: boolean;
    };
    const roleStates = new Map<PeopleRoleKey, RoleState>();
    attentions.forEach((attention) => {
      const rule = ATTENTION_ROLE_RULES[attention];
      if (!rule) {
        return;
      }
      rule.applied.forEach((role) => {
        const state: RoleState = roleStates.get(role) ?? {
          applied: false,
          optional: false,
          cleared: false,
        };
        state.applied = true;
        roleStates.set(role, state);
      });
      rule.optional.forEach((role) => {
        const state: RoleState = roleStates.get(role) ?? {
          applied: false,
          optional: false,
          cleared: false,
        };
        state.optional = true;
        roleStates.set(role, state);
      });
      rule.cleared.forEach((role) => {
        const state: RoleState = roleStates.get(role) ?? {
          applied: false,
          optional: false,
          cleared: false,
        };
        state.cleared = true;
        roleStates.set(role, state);
      });
    });

    const finalApplied = new Set<PeopleRoleKey>();
    const finalOptional = new Set<PeopleRoleKey>();

    PEOPLE_ROLE_KEYS.forEach((role) => {
      const roleState = roleStates.get(role) ?? {
        applied: false,
        optional: false,
        cleared: false,
      };

      const hasApplied = roleState.applied;
      const hasOptional = roleState.optional;
      const hasCleared = roleState.cleared || !roleStates.has(role);

      if (hasApplied && (hasOptional || hasCleared)) {
        finalOptional.add(role);
      } else if (hasApplied) {
        finalApplied.add(role);
      } else if (hasOptional) {
        finalOptional.add(role);
      }
    });

    let nextState = state;
    PEOPLE_ROLE_KEYS.forEach((role) => {
      if (finalApplied.has(role)) {
        nextState = setPeopleRoleValues(nextState, role, selection);
      } else {
        nextState = setPeopleRoleValues(nextState, role, []);
      }
    });
    PEOPLE_ROLE_KEYS.forEach((role) => {
      if (finalOptional.has(role) && !finalApplied.has(role)) {
        nextState = setOptionalPersonValues(nextState, role, selection);
      } else {
        nextState = setOptionalPersonValues(nextState, role, []);
      }
    });

    return nextState;
  }

  let nextState = state;
  PEOPLE_ROLE_KEYS.forEach((role) => {
    if (appliedRoles.has(role)) {
      nextState = setPeopleRoleValues(nextState, role, selection);
    } else {
      nextState = setPeopleRoleValues(nextState, role, []);
    }
  });
  PEOPLE_ROLE_KEYS.forEach((role) => {
    if (optionalRoles.has(role) && !appliedRoles.has(role)) {
      nextState = setOptionalPersonValues(nextState, role, selection);
    } else {
      nextState = setOptionalPersonValues(nextState, role, []);
    }
  });

  return nextState;
}

function syncPeopleFilters(state: FilterState): FilterState {
  const attentionSynced = syncPeopleFiltersWithAttention(state);
  if (hasActiveAttentionFilters(attentionSynced)) {
    return attentionSynced;
  }
  return syncPeopleSelectionFromRoles(attentionSynced);
}

function isOptionalPeopleEmpty(state: FilterState): boolean {
  return !PEOPLE_ROLE_KEYS.some((role) => {
    const values = state.optionalPersonIds?.[role];
    return Array.isArray(values) && values.length > 0;
  });
}

const ATTENTION_CATEGORY_MAP = {
  no_attention: [],
  issue_backlog: ["issue"],
  issue_stalled: ["issue"],
  pr_open_too_long: ["pull_request"],
  pr_inactive: ["pull_request"],
  review_requests_pending: ["pull_request"],
  unanswered_mentions: [],
} satisfies Record<
  ActivityAttentionFilter,
  ReadonlyArray<ActivityItemCategory>
>;

function sortCategoriesForDisplay(
  categories: Iterable<ActivityItemCategory>,
): ActivityItemCategory[] {
  const allowed = new Set(categories);
  if (!allowed.size) {
    return [];
  }
  return CATEGORY_OPTIONS.map((option) => option.value).filter((value) =>
    allowed.has(value),
  );
}

function collectRequiredCategoriesFromAttention(
  attention: ActivityAttentionFilter[],
): ActivityItemCategory[] | null {
  const required = new Set<ActivityItemCategory>();
  let hasWildcard = false;
  attention.forEach((value) => {
    const mapped = ATTENTION_CATEGORY_MAP[value] ?? [];
    if (mapped.length === 0) {
      hasWildcard = true;
      return;
    }
    for (const category of mapped) {
      required.add(category);
    }
  });
  if (hasWildcard) {
    return null;
  }
  return sortCategoriesForDisplay(required);
}

function mergeCategoriesWithRequirements(
  currentCategories: ActivityItemCategory[],
  requiredCategories: ActivityItemCategory[] | null,
): ActivityItemCategory[] {
  if (requiredCategories === null) {
    return [];
  }
  if (!requiredCategories.length) {
    return currentCategories;
  }
  const merged = new Set<ActivityItemCategory>();
  if (currentCategories.length) {
    for (const category of currentCategories) {
      merged.add(category);
    }
  }
  for (const category of requiredCategories) {
    merged.add(category);
  }
  const ordered = sortCategoriesForDisplay(merged);
  if (ordered.length === CATEGORY_OPTIONS.length) {
    return [];
  }
  return ordered;
}

function attentionMatchesCategories(
  attention: ActivityAttentionFilter,
  categories: ActivityItemCategory[],
): boolean {
  if (!categories.length) {
    return true;
  }
  const mapped = ATTENTION_CATEGORY_MAP[attention] ?? [];
  if (!mapped.length) {
    return true;
  }
  return mapped.some((category) => categories.includes(category));
}

function filterAttentionByCategories(
  attentions: ActivityAttentionFilter[],
  categories: ActivityItemCategory[],
): ActivityAttentionFilter[] {
  if (!attentions.length) {
    return attentions;
  }
  if (!categories.length) {
    return [...attentions];
  }
  return attentions.filter((value) =>
    attentionMatchesCategories(value, categories),
  );
}

function includesIssueCategory(categories: ActivityItemCategory[]) {
  return categories.length === 0 || categories.includes("issue");
}

function arraysShallowEqual(first: string[], second: string[]) {
  if (first.length !== second.length) {
    return false;
  }
  return first.every((value, index) => value === second[index]);
}

function normalizePeopleIds(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function ensureValidTaskMode(
  state: FilterState,
  currentUserId: string | null,
  allowedUserIds: ReadonlySet<string>,
): FilterState {
  if (state.taskMode !== "my_todo") {
    return state;
  }
  if (!currentUserId || !allowedUserIds.has(currentUserId)) {
    if (state.taskMode === null) {
      return state;
    }
    return { ...state, taskMode: null };
  }
  const target = normalizePeopleIds([currentUserId]);
  const roles: PeopleRoleKey[] = [
    "authorIds",
    "assigneeIds",
    "reviewerIds",
    "mentionedUserIds",
    "maintainerIds",
  ];
  const allRolesMatch = roles.every((role) => {
    const values = getPeopleRoleValues(state, role);
    return arraysShallowEqual(normalizePeopleIds(values), target);
  });
  const normalizedSelection = normalizePeopleIds(state.peopleSelection ?? []);
  const selectionMatches =
    normalizedSelection.length === 0 ||
    arraysShallowEqual(normalizedSelection, target);
  if (allRolesMatch && selectionMatches) {
    return state;
  }
  return { ...state, taskMode: null };
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
  const targetSet = new Set(getPeopleRoleTargets(resolvedCategories));
  if (state.taskMode === "my_todo") {
    targetSet.add("maintainerIds");
    targetSet.delete("commenterIds");
    targetSet.delete("reactorIds");
  }
  const targets = Array.from(targetSet).filter((role) => {
    if (role !== "mentionedUserIds") {
      return true;
    }
    const values = getPeopleRoleValues(state, role);
    const optional = state.optionalPersonIds?.mentionedUserIds ?? [];
    return values.length > 0 || optional.length > 0;
  });
  const hasAttention = hasActiveAttentionFilters(state);
  if (hasAttention) {
    const selectionValues =
      state.peopleSelection.length > 0
        ? Array.from(new Set(state.peopleSelection))
        : collectPeopleSelectionFromRoles(state);
    const normalizedSelection = normalizePeopleIds(selectionValues);
    const matchesSelection =
      normalizedSelection.length === 0 ||
      PEOPLE_ROLE_KEYS.every((role) => {
        const values = getPeopleRoleValues(state, role);
        if (values.length === 0) {
          return true;
        }
        return arraysShallowEqual(
          normalizePeopleIds(values),
          normalizedSelection,
        );
      });
    return {
      selection: matchesSelection ? selectionValues : [],
      isSynced: matchesSelection,
      targets,
    };
  }
  if (!targets.length) {
    return { selection: [], isSynced: true, targets };
  }

  let baseline: string[] | null = null;
  let inSync = true;

  for (const role of targets) {
    const values = getPeopleRoleValues(state, role);
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
      if (getPeopleRoleValues(state, role).length > 0) {
        inSync = false;
        break;
      }
    }
  }

  const baselineValues = baseline ? [...baseline] : [];
  let selectionValues: string[] = [];
  if (state.peopleSelection.length > 0) {
    selectionValues = Array.from(new Set(state.peopleSelection));
    if (inSync) {
      if (
        baselineValues.length > 0 &&
        !arraysShallowEqual(selectionValues, baselineValues)
      ) {
        inSync = false;
        selectionValues = [];
      }
    } else {
      selectionValues = [];
    }
  } else if (inSync) {
    selectionValues = baselineValues;
  }

  return {
    selection: selectionValues,
    isSynced: inSync,
    targets,
  };
}

function derivePeopleOrModeRoles(state: FilterState): {
  isOrMode: boolean;
  roles: Set<PeopleRoleKey>;
} {
  if (hasActiveAttentionFilters(state)) {
    return { isOrMode: false, roles: new Set() };
  }

  const populatedRoles: PeopleRoleKey[] = [];
  const normalizedValues = new Map<PeopleRoleKey, string[]>();

  PEOPLE_ROLE_KEYS.forEach((role) => {
    const values = getPeopleRoleValues(state, role);
    if (values.length === 0) {
      return;
    }
    const normalized = normalizePeopleIds(values);
    populatedRoles.push(role);
    normalizedValues.set(role, normalized);
  });

  if (populatedRoles.length === 0) {
    return { isOrMode: false, roles: new Set() };
  }

  const baseline = normalizedValues.get(populatedRoles[0]) ?? [];
  const allMatch = populatedRoles.every((role) => {
    const candidate = normalizedValues.get(role) ?? [];
    return arraysShallowEqual(baseline, candidate);
  });

  if (!allMatch || baseline.length === 0) {
    return { isOrMode: false, roles: new Set() };
  }

  return { isOrMode: true, roles: new Set(populatedRoles) };
}

function applyPeopleSelection(
  state: FilterState,
  peopleIds: string[],
  categoriesOverride?: ActivityItemCategory[],
): FilterState {
  const resolvedCategories = categoriesOverride ?? state.categories;
  const targets = getPeopleRoleTargets(resolvedCategories);
  const unique = Array.from(new Set(peopleIds));
  let nextState = state;
  let changed = false;

  targets.forEach((role) => {
    const updated = setPeopleRoleValues(nextState, role, unique);
    if (updated !== nextState) {
      nextState = updated;
      changed = true;
    }
  });

  PEOPLE_ROLE_KEYS.forEach((role) => {
    if (targets.includes(role)) {
      return;
    }
    const updated = clearPeopleRoleValues(nextState, role);
    if (updated !== nextState) {
      nextState = updated;
      changed = true;
    }
  });

  if (!arraysShallowEqual(nextState.peopleSelection, unique)) {
    nextState = {
      ...nextState,
      peopleSelection: unique,
    };
    changed = true;
  }

  if (changed) {
    nextState = {
      ...nextState,
      optionalPersonIds: {},
    };
  }

  return changed ? syncPeopleFilters(nextState) : state;
}

function sanitizePeopleIds(
  state: FilterState,
  allowed: ReadonlySet<string>,
): FilterState {
  let nextState = state;
  let changed = false;

  PEOPLE_ROLE_KEYS.forEach((role) => {
    const current = getPeopleRoleValues(nextState, role);
    const filtered = current.filter((id) => allowed.has(id));
    if (!arraysShallowEqual(current, filtered)) {
      nextState = setPeopleRoleValues(nextState, role, filtered);
      changed = true;
    }
  });

  const filteredSelection = nextState.peopleSelection.filter((id) =>
    allowed.has(id),
  );
  if (!arraysShallowEqual(nextState.peopleSelection, filteredSelection)) {
    nextState = {
      ...nextState,
      peopleSelection: filteredSelection,
    };
    changed = true;
  }

  if (!changed) {
    return state;
  }

  let optionalChanged = false;
  const updatedOptional: FilterState["optionalPersonIds"] = {};
  PEOPLE_ROLE_KEYS.forEach((role) => {
    const optionalValues = nextState.optionalPersonIds[role];
    if (Array.isArray(optionalValues) && optionalValues.length > 0) {
      const filteredOptional = optionalValues.filter((id) => allowed.has(id));
      if (filteredOptional.length > 0) {
        updatedOptional[role] = filteredOptional;
      }
      if (!arraysShallowEqual(optionalValues, filteredOptional)) {
        optionalChanged = true;
      }
    }
  });

  if (optionalChanged) {
    nextState = {
      ...nextState,
      optionalPersonIds: updatedOptional,
    };
  }

  const peopleState = derivePeopleState(nextState);
  if (peopleState.isSynced) {
    return applyPeopleSelection(nextState, peopleState.selection);
  }

  return syncPeopleFilters(nextState);
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
  resolveLabelKeys: (labels: readonly string[]) => string[],
) {
  const params = normalizeSearchParams(
    {
      ...filters,
      labelKeys: resolveLabelKeys(filters.labelKeys),
    },
    defaultPerPage,
  );
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

type AttentionBadgeDescriptor = {
  key: string;
  label: string;
  variant: "default" | "manual" | "ai-soft";
  tooltip?: string;
};

function buildAttentionBadges(
  item: ActivityItem,
  options: { useMentionAi: boolean },
) {
  const badges: AttentionBadgeDescriptor[] = [];
  const push = (
    key: string,
    label: string,
    variant: AttentionBadgeDescriptor["variant"] = "default",
    tooltip?: string,
  ) => {
    badges.push({ key, label, variant, tooltip });
  };

  const hasManualSuppress = item.mentionWaits?.some(
    (wait) => wait.manualRequiresResponse === false,
  );
  const hasAiSoftBadge =
    !options.useMentionAi &&
    item.mentionWaits?.some((wait) => {
      if (wait.manualRequiresResponse === true) {
        return false;
      }
      return wait.requiresResponse === false;
    });

  if (item.attention.unansweredMention) {
    if (hasAiSoftBadge) {
      push(
        "unanswered-mention",
        "응답 없는 멘션",
        "ai-soft",
        "AI는 응답을 요구하지 않은 멘션으로 생각합니다.",
      );
    } else {
      push("unanswered-mention", "응답 없는 멘션");
    }
  }
  if (item.attention.reviewRequestPending) {
    push("review-request", "응답 없는 리뷰 요청");
  }
  if (item.attention.idlePr) {
    push("idle-pr", "업데이트 없는 PR");
  }
  if (item.attention.backlogIssue) {
    push("backlog-issue", "정체된 Backlog 이슈");
  }
  if (item.attention.stalledIssue) {
    push("stalled-issue", "정체된 In Progress 이슈");
  }
  if (hasManualSuppress) {
    push("manual-suppress", "응답 요구가 아님", "manual");
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
  appliedValues,
  optionalValues = [],
  onChange,
  onOptionalChange,
  options,
  emptyLabel,
  disabled = false,
  tone = "default",
}: {
  label: ReactNode;
  placeholder?: string;
  appliedValues: string[];
  optionalValues?: string[];
  onChange: (next: string[]) => void;
  onOptionalChange?: (next: string[]) => void;
  options: MultiSelectOption[];
  emptyLabel?: string;
  disabled?: boolean;
  tone?: "default" | "or";
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

  const optionalSet = useMemo(() => new Set(optionalValues), [optionalValues]);
  const allSelectedSet = useMemo(
    () => new Set([...appliedValues, ...optionalValues]),
    [appliedValues, optionalValues],
  );

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => {
      if (allSelectedSet.has(option.value)) {
        return false;
      }
      if (!normalized.length) {
        return true;
      }
      const haystack =
        `${option.label} ${option.description ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [allSelectedSet, options, query]);

  const addValue = useCallback(
    (nextValue: string) => {
      if (disabled) {
        return;
      }
      if (allSelectedSet.has(nextValue)) {
        if (optionalSet.has(nextValue) && onOptionalChange) {
          onOptionalChange(
            optionalValues.filter((entry) => entry !== nextValue),
          );
        }
        return;
      }
      if (optionalSet.has(nextValue) && onOptionalChange) {
        onOptionalChange(optionalValues.filter((entry) => entry !== nextValue));
      }
      onChange([...appliedValues, nextValue]);
      setQuery("");
    },
    [
      allSelectedSet,
      appliedValues,
      disabled,
      onChange,
      onOptionalChange,
      optionalSet,
      optionalValues,
    ],
  );

  const removeValue = useCallback(
    (target: string) => {
      if (disabled) {
        return;
      }
      onChange(appliedValues.filter((entry) => entry !== target));
    },
    [appliedValues, disabled, onChange],
  );

  const removeOptionalValue = useCallback(
    (target: string) => {
      if (disabled || !onOptionalChange) {
        return;
      }
      onOptionalChange(optionalValues.filter((entry) => entry !== target));
    },
    [disabled, onOptionalChange, optionalValues],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === "Backspace" && !query.length && appliedValues.length) {
        event.preventDefault();
        const next = [...appliedValues];
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
    [
      addValue,
      appliedValues,
      disabled,
      filteredOptions,
      onChange,
      query.length,
    ],
  );

  const isOrTone = tone === "or";

  return (
    <div
      ref={containerRef}
      className={cn("space-y-2", disabled && "cursor-not-allowed")}
      aria-disabled={disabled}
      data-disabled={disabled ? "true" : undefined}
    >
      <Label
        className={cn(
          "text-xs font-semibold uppercase text-foreground",
          disabled && "text-muted-foreground",
        )}
      >
        {label}
      </Label>
      <div
        className={cn(
          "rounded-md border border-border bg-background px-2 py-1 text-sm",
          isFocused && !disabled && "ring-2 ring-ring",
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          {appliedValues.length === 0 && optionalValues.length === 0 && (
            <span className="text-xs text-muted-foreground/70">
              {emptyLabel ?? "미적용"}
            </span>
          )}
          {optionalValues.map((entry) => {
            const option = options.find((item) => item.value === entry);
            return (
              <span
                key={`optional-${entry}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                {option?.label ?? entry}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-muted/70"
                  onClick={() => removeOptionalValue(entry)}
                  aria-label={`Remove optional ${option?.label ?? entry}`}
                  disabled={disabled || !onOptionalChange}
                >
                  ×
                </button>
              </span>
            );
          })}
          {appliedValues.map((entry) => {
            const option = options.find((item) => item.value === entry);
            return (
              <span
                key={`applied-${entry}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs",
                  isOrTone
                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "bg-primary/10 text-primary",
                )}
              >
                {option?.label ?? entry}
                <button
                  type="button"
                  className={cn(
                    "rounded-full p-0.5",
                    isOrTone
                      ? "hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30"
                      : "hover:bg-primary/20",
                  )}
                  onClick={() => removeValue(entry)}
                  aria-label={`Remove ${option?.label ?? entry}`}
                  disabled={disabled}
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
            onFocus={() => {
              if (disabled) {
                return;
              }
              setIsFocused(true);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-[120px] bg-transparent px-1 py-1 outline-none"
            disabled={disabled}
          />
        </div>
      </div>
      {!disabled && isFocused && filteredOptions.length > 0 && (
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
  disabled = false,
  ariaDescribedBy,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  variant?: "active" | "inactive" | "muted";
  disabled?: boolean;
  ariaDescribedBy?: string;
}) {
  const resolvedVariant = disabled
    ? "disabled"
    : (variant ?? (active ? "active" : "inactive"));
  const variantClass =
    resolvedVariant === "active"
      ? "border-primary bg-primary/10 text-primary"
      : resolvedVariant === "muted"
        ? "border-border/60 bg-muted/15 text-muted-foreground/80 hover:border-border hover:bg-muted/25 hover:text-foreground"
        : resolvedVariant === "disabled"
          ? "border-border/60 bg-muted/15 text-muted-foreground/60 cursor-not-allowed"
          : "border-border text-foreground/80 hover:bg-muted";

  return (
    <button
      type="button"
      className={cn(
        "group rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        variantClass,
      )}
      aria-pressed={active}
      aria-describedby={ariaDescribedBy}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function AiFilterControl({
  checked,
  onToggle,
  tooltipId,
  tooltipText,
}: {
  checked: boolean;
  onToggle: () => void;
  tooltipId?: string;
  tooltipText: string;
}) {
  const buttonClass = checked
    ? "border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-500/30"
    : "bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground";

  const staticGlowClass = checked
    ? "bg-sky-500/25 opacity-70"
    : "bg-sky-500/10 opacity-0 group-hover:opacity-40";
  const pulseRingClass = checked
    ? "bg-sky-400/30 opacity-70"
    : "bg-sky-400/15 opacity-0 group-hover:opacity-45";

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={tooltipId}
        onClick={onToggle}
        className={cn(
          "group relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 transition-colors duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          buttonClass,
        )}
      >
        <span className="relative z-10">
          <Bot
            className="h-3.5 w-3.5 transition-transform duration-300 group-hover:scale-110 group-active:scale-95"
            aria-hidden="true"
          />
        </span>
        <span
          className={cn(
            "pointer-events-none absolute -inset-1 z-0 rounded-full blur-md transition duration-900",
            staticGlowClass,
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "pointer-events-none absolute -inset-0.5 z-0 rounded-full",
            pulseRingClass,
          )}
          aria-hidden="true"
          style={{
            animation: `aiPulse ${checked ? "3.1s" : "4s"} ease-out infinite`,
          }}
        />
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 w-52 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {tooltipText}
        </span>
        <span className="sr-only">
          {checked ? "AI 분류 사용 중" : "AI 분류 사용 안 함"}
        </span>
      </button>
      <style jsx>{`
        @keyframes aiPulse {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          55% {
            transform: scale(1.4);
            opacity: 0.12;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </>
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
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-background/80 backdrop-blur">
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
  currentUserIsAdmin,
}: ActivityViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const perPageDefault =
    initialData.pageInfo.perPage ?? PER_PAGE_CHOICES[1] ?? 25;
  const labelMetadata = useMemo(() => {
    const groups = new Map<
      string,
      { keys: Set<string>; repositories: Set<string> }
    >();
    const keyToName = new Map<string, string>();

    filterOptions.labels.forEach((label) => {
      const rawName = typeof label.name === "string" ? label.name.trim() : "";
      const labelKey = label.key ?? "";
      const separatorIndex = labelKey.lastIndexOf(":");
      const fallback =
        separatorIndex >= 0 && separatorIndex < labelKey.length - 1
          ? labelKey.slice(separatorIndex + 1).trim()
          : labelKey.trim();
      const normalizedName =
        rawName.length > 0
          ? rawName
          : fallback.length > 0
            ? fallback
            : labelKey;

      keyToName.set(labelKey, normalizedName);

      let group = groups.get(normalizedName);
      if (!group) {
        group = { keys: new Set<string>(), repositories: new Set<string>() };
        groups.set(normalizedName, group);
      }
      group.keys.add(labelKey);

      const repositoryName = label.repositoryNameWithOwner?.trim();
      if (repositoryName && repositoryName.length > 0) {
        group.repositories.add(repositoryName);
      }
    });

    const nameToKeys = new Map<string, string[]>();
    const options: MultiSelectOption[] = Array.from(groups.entries())
      .sort(([firstName], [secondName]) => firstName.localeCompare(secondName))
      .map(([name, group]) => {
        const keys = Array.from(group.keys).sort((a, b) => a.localeCompare(b));
        nameToKeys.set(name, keys);

        let description: string | null = null;
        if (group.repositories.size > 0) {
          const repoList = Array.from(group.repositories).sort((a, b) =>
            a.localeCompare(b),
          );
          if (repoList.length > 3) {
            const preview = repoList.slice(0, 3).join(", ");
            description = `${preview} 외 ${repoList.length - 3}개 저장소`;
          } else {
            description = repoList.join(", ");
          }
        }

        return {
          value: name,
          label: name,
          description,
        };
      });

    return {
      options,
      nameToKeys,
      keyToName,
    };
  }, [filterOptions.labels]);

  const convertFilterLabelKeysToNames = useCallback(
    (state: FilterState): FilterState => {
      if (!state.labelKeys.length) {
        return state;
      }
      const seen = new Set<string>();
      const next: string[] = [];
      state.labelKeys.forEach((value) => {
        let resolved = labelMetadata.keyToName.get(value);
        if (!resolved) {
          const lastColon = value.lastIndexOf(":");
          if (lastColon >= 0 && lastColon < value.length - 1) {
            resolved = value.slice(lastColon + 1);
          } else {
            resolved = value;
          }
        }
        const trimmed = resolved.trim();
        const finalValue = trimmed.length ? trimmed : resolved;
        if (!finalValue.length || seen.has(finalValue)) {
          return;
        }
        seen.add(finalValue);
        next.push(finalValue);
      });

      if (
        next.length === state.labelKeys.length &&
        next.every((value, index) => value === state.labelKeys[index])
      ) {
        return state;
      }
      return { ...state, labelKeys: next };
    },
    [labelMetadata],
  );

  const resolveLabelKeys = useCallback(
    (names: readonly string[]): string[] => {
      if (!names.length) {
        return [];
      }
      const resolved = new Set<string>();
      names.forEach((name) => {
        const keys = labelMetadata.nameToKeys.get(name);
        if (keys && keys.length > 0) {
          for (const key of keys) {
            resolved.add(key);
          }
        } else {
          resolved.add(name);
        }
      });
      return Array.from(resolved).sort((a, b) => a.localeCompare(b));
    },
    [labelMetadata],
  );

  const augmentedUsers = useMemo(() => {
    if (!currentUserId) {
      return filterOptions.users;
    }
    const hasCurrentUser = filterOptions.users.some(
      (user) => user.id === currentUserId,
    );
    if (hasCurrentUser) {
      return filterOptions.users;
    }
    return [
      ...filterOptions.users,
      {
        id: currentUserId,
        login: null,
        name: null,
        avatarUrl: null,
      },
    ];
  }, [currentUserId, filterOptions.users]);

  const userOptions = useMemo<MultiSelectOption[]>(
    () =>
      augmentedUsers.map((user) => ({
        value: user.id,
        label: user.login?.length ? user.login : (user.name ?? user.id),
        description:
          user.name && user.login && user.name !== user.login
            ? user.name
            : null,
      })),
    [augmentedUsers],
  );

  const allowedUserIds = useMemo(
    () => new Set(augmentedUsers.map((user) => user.id)),
    [augmentedUsers],
  );

  const normalizeFilterState = useCallback(
    (raw: FilterState): FilterState => {
      const converted = convertFilterLabelKeysToNames(raw);
      const synced = syncPeopleFiltersWithAttention(converted);
      const rawMentioned = raw.mentionedUserIds ?? [];
      let nextState = synced;
      if (
        rawMentioned.length === 0 &&
        arraysShallowEqual(
          synced.mentionedUserIds ?? [],
          synced.peopleSelection ?? [],
        )
      ) {
        nextState = removeMentionRole(synced);
      }
      return ensureValidTaskMode(nextState, currentUserId, allowedUserIds);
    },
    [allowedUserIds, convertFilterLabelKeysToNames, currentUserId],
  );

  const initialState = useMemo(
    () => normalizeFilterState(buildFilterState(initialParams, perPageDefault)),
    [initialParams, normalizeFilterState, perPageDefault],
  );

  const perPageChoices = useMemo(() => {
    const set = new Set(PER_PAGE_CHOICES);
    set.add(perPageDefault);
    return Array.from(set).sort((a, b) => a - b);
  }, [perPageDefault]);

  const [draft, setDraft] = useState<FilterState>(initialState);
  const [applied, setApplied] = useState<FilterState>(initialState);
  const [listData, setListData] = useState<ActivityListResult>(initialData);
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
  const [pendingMentionOverrideKey, setPendingMentionOverrideKey] = useState<
    string | null
  >(null);
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
  const jumpDateInputId = useId();
  const attentionTooltipPrefix = useId();
  const mentionAiTooltipId = `${attentionTooltipPrefix}-mention-ai`;
  const mentionAiTooltipText = "응답을 요구한 멘션인지 여부를 AI가 판단합니다.";

  useEffect(() => {
    setDraft((current) => normalizeFilterState(current));
    setApplied((current) => normalizeFilterState(current));
  }, [normalizeFilterState]);

  useEffect(() => {
    setDraft(initialState);
    setApplied(initialState);
    setListData(initialData);
  }, [initialData, initialState]);
  const activeTimezone = listData.timezone ?? null;
  const activeDateTimeFormat = listData.dateTimeFormat;
  const trimmedTimezone = activeTimezone?.trim() ?? "";
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;
  const formatDateTimeWithSettings = useCallback(
    (value: string | null | undefined) => {
      if (!value) {
        return null;
      }

      return formatDateTime(
        value,
        activeTimezone ?? undefined,
        activeDateTimeFormat,
      );
    },
    [activeTimezone, activeDateTimeFormat],
  );
  const lastSyncCompletedAt = listData.lastSyncCompletedAt;
  const currentPage = listData.pageInfo.page;
  const visibleItems = listData.items;
  const totalPages = listData.pageInfo.totalPages;
  const totalCount = listData.pageInfo.totalCount;
  const totalPagesDisplay = totalPages;
  const totalCountDisplay = totalCount.toLocaleString();
  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

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
    const validIds = new Set(listData.items.map((item) => item.id));

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
  }, [openItemId, listData.items]);

  const repositoryOptions = useMemo<MultiSelectOption[]>(
    () =>
      filterOptions.repositories.map((repository) => ({
        value: repository.id,
        label: repository.nameWithOwner ?? repository.name ?? repository.id,
        description: repository.name ?? repository.nameWithOwner ?? null,
      })),
    [filterOptions.repositories],
  );

  const labelOptions = labelMetadata.options;

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
    const allowed = new Set(labelOptions.map((label) => label.value));
    setDraft((current) => {
      const sanitized = current.labelKeys.filter((key) => allowed.has(key));
      if (sanitized.length === current.labelKeys.length) {
        return current;
      }

      return { ...current, labelKeys: sanitized };
    });
    setApplied((current) => {
      const sanitized = current.labelKeys.filter((key) => allowed.has(key));
      if (sanitized.length === current.labelKeys.length) {
        return current;
      }

      return { ...current, labelKeys: sanitized };
    });
  }, [labelOptions]);

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
        removeMentionRole(
          applyPeopleSelection(buildFilterState({}, perPage), [currentUserId]),
        );
      const buildMyTodoState = (perPage: number) => {
        const selection = [currentUserId];
        const roles: PeopleRoleKey[] = [
          "authorIds",
          "assigneeIds",
          "reviewerIds",
          "mentionedUserIds",
          "maintainerIds",
        ];
        const defaultPrStatuses: ActivityPullRequestStatusFilter[] = [
          "pr_open",
        ];
        const defaultIssueBaseStatuses: ActivityIssueBaseStatusFilter[] = [
          "issue_open",
        ];
        const defaultProjectStatuses: ActivityStatusFilter[] = [
          "no_status",
          "todo",
          "in_progress",
          "pending",
        ];
        let next = buildFilterState({}, perPage);
        roles.forEach((role) => {
          next = setPeopleRoleValues(next, role, selection);
        });
        next = syncPeopleFilters(next);
        const baseState = {
          ...next,
          taskMode: "my_todo" as const,
          peopleSelection: selection,
          prStatuses: [...defaultPrStatuses],
          issueBaseStatuses: [...defaultIssueBaseStatuses],
          statuses: [...defaultProjectStatuses],
        };
        return syncPeopleSelectionFromRoles(baseState);
      };

      definitions.push(
        {
          id: "my_updates",
          label: "내 활동",
          description: "나와 관련된 최신 활동을 확인합니다.",
          buildState: (perPage: number) => buildSelfState(perPage),
          icon: User,
        },
        {
          id: "my_todo",
          label: "내 할 일",
          description: "내가 처리해야 할 이슈, PR, 멘션을 모아봅니다.",
          buildState: (perPage: number) => buildMyTodoState(perPage),
          icon: ListTodo,
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
      const baseState = normalizeFilterState({
        ...definition.buildState(draft.perPage),
        page: 1,
      });
      const payload = buildSavedFilterPayload(baseState);
      keys.add(canonicalizeActivityParams(payload));
    });
    return keys;
  }, [draft.perPage, normalizeFilterState, quickFilterDefinitions]);

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
      savedFilters.map((filter) => {
        const state = normalizeFilterState(
          buildFilterState(filter.payload, perPageDefault),
        );
        return {
          id: filter.id,
          key: canonicalizeActivityParams(buildSavedFilterPayload(state)),
        };
      }),
    [normalizeFilterState, perPageDefault, savedFilters],
  );

  const activeQuickFilterId = useMemo(() => {
    for (const definition of quickFilterDefinitions) {
      const baseState = normalizeFilterState({
        ...definition.buildState(draft.perPage),
        page: 1,
      });
      const payload = buildSavedFilterPayload(baseState);
      if (canonicalizeActivityParams(payload) === canonicalDraftKey) {
        return definition.id;
      }
    }
    return null;
  }, [
    canonicalDraftKey,
    draft.perPage,
    normalizeFilterState,
    quickFilterDefinitions,
  ]);

  const ensureNoMentionRole = useCallback((state: FilterState): FilterState => {
    const hasMentionValues =
      (state.mentionedUserIds?.length ?? 0) > 0 ||
      Boolean(state.optionalPersonIds?.mentionedUserIds);
    if (!hasMentionValues) {
      return state;
    }
    return removeMentionRole(state);
  }, []);

  useEffect(() => {
    if (
      activeQuickFilterId === "my_updates" ||
      activeQuickFilterId === "my_attention"
    ) {
      setDraft((current) => ensureNoMentionRole(current));
      setApplied((current) => ensureNoMentionRole(current));
    }
  }, [activeQuickFilterId, ensureNoMentionRole]);

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
  const issueFiltersDisabled = !allowIssueStatuses;
  const prFiltersDisabled = !allowPullRequestStatuses;

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
      let mutated = false;
      if (sanitizedStatuses.length !== current.statuses.length) {
        next = { ...next, statuses: sanitizedStatuses };
        mutated = true;
      }
      if (next.issueBaseStatuses.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issueBaseStatuses = [];
      }
      if (next.issueTypeIds.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issueTypeIds = [];
      }
      if (next.issuePriorities.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issuePriorities = [];
      }
      if (next.issueWeights.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issueWeights = [];
      }
      if (next.linkedIssueStates.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.linkedIssueStates = [];
      }
      return next;
    });

    setApplied((current) => {
      const sanitizedStatuses = current.statuses.filter(
        (status) => !ISSUE_STATUS_VALUE_SET.has(status),
      );
      let next: FilterState = current;
      let mutated = false;
      if (sanitizedStatuses.length !== current.statuses.length) {
        next = { ...next, statuses: sanitizedStatuses };
        mutated = true;
      }
      if (next.issueBaseStatuses.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issueBaseStatuses = [];
      }
      if (next.issueTypeIds.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issueTypeIds = [];
      }
      if (next.issuePriorities.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issuePriorities = [];
      }
      if (next.issueWeights.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.issueWeights = [];
      }
      if (next.linkedIssueStates.length > 0) {
        if (!mutated) {
          next = { ...next };
          mutated = true;
        }
        next.linkedIssueStates = [];
      }
      return next;
    });
  }, [allowIssueStatuses]);

  useEffect(() => {
    if (allowPullRequestStatuses) {
      return;
    }

    setDraft((current) => {
      if (current.prStatuses.length === 0 && current.reviewerIds.length === 0) {
        return current;
      }
      return {
        ...current,
        prStatuses: [],
        reviewerIds: [],
      };
    });

    setApplied((current) => {
      if (current.prStatuses.length === 0 && current.reviewerIds.length === 0) {
        return current;
      }
      return {
        ...current,
        prStatuses: [],
        reviewerIds: [],
      };
    });
  }, [allowPullRequestStatuses]);

  const peopleState = useMemo(() => derivePeopleState(draft), [draft]);
  const peopleSelection = peopleState.selection;
  const peopleSynced = peopleState.isSynced;
  const peopleOrModeResult = useMemo(
    () => derivePeopleOrModeRoles(draft),
    [draft],
  );
  const peopleOrModeRoles = peopleOrModeResult.isOrMode
    ? peopleOrModeResult.roles
    : null;
  const hasActiveAttention = draft.attention.some(
    (value) => value !== "no_attention",
  );
  const highlightedPeopleRoles = useMemo(() => {
    const roles = new Set<PeopleRoleKey>();
    const shouldHighlightQuickFilter =
      activeQuickFilterId === "my_updates" ||
      activeQuickFilterId === "my_attention" ||
      activeQuickFilterId === "my_todo";
    const highlightOrMode =
      Boolean(peopleOrModeRoles) &&
      (shouldHighlightQuickFilter ||
        hasActiveAttention ||
        peopleSelection.length > 0);
    if (highlightOrMode && peopleOrModeRoles) {
      for (const role of peopleOrModeRoles) {
        roles.add(role);
      }
    } else if (shouldHighlightQuickFilter || hasActiveAttention) {
      for (const role of PEOPLE_ROLE_KEYS) {
        if (getPeopleRoleValues(draft, role).length > 0) {
          roles.add(role);
        }
      }
    }
    return roles;
  }, [
    activeQuickFilterId,
    draft,
    hasActiveAttention,
    peopleOrModeRoles,
    peopleSelection.length,
  ]);
  const hasAppliedPeopleFilters = useMemo(
    () =>
      PEOPLE_ROLE_KEYS.some(
        (role) => getPeopleRoleValues(draft, role).length > 0,
      ),
    [draft],
  );
  const peopleFiltersLocked =
    hasActiveAttention &&
    (peopleSelection.length > 0 || hasAppliedPeopleFilters);
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

  const fetchActivity = useCallback(
    async (
      nextFilters: FilterState,
      options: {
        jumpToDate?: string | null;
        previousSync?: string | null;
      } = {},
    ) => {
      setIsLoading(true);
      setError(null);
      requestCounterRef.current += 1;
      const requestId = requestCounterRef.current;

      fetchControllerRef.current?.abort();
      const controller = new AbortController();
      fetchControllerRef.current = controller;

      const resolvedFilters: FilterState = {
        ...nextFilters,
        labelKeys: resolveLabelKeys(nextFilters.labelKeys),
      };
      const params = normalizeSearchParams(resolvedFilters, perPageDefault);
      if (options.jumpToDate) {
        params.set("jumpTo", options.jumpToDate);
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

        setListData(result);
        const nextState: FilterState = {
          ...nextFilters,
          page: result.pageInfo.page,
          perPage: result.pageInfo.perPage,
        };
        setApplied(nextState);
        setDraft(nextState);
        applyFiltersToQuery(
          router,
          nextState,
          perPageDefault,
          resolveLabelKeys,
        );

        if (
          options.previousSync &&
          result.lastSyncCompletedAt &&
          options.previousSync === result.lastSyncCompletedAt
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
    [perPageDefault, resolveLabelKeys, router, showNotification],
  );

  const handleMentionOverride = useCallback(
    async (params: {
      itemId: string;
      commentId: string;
      mentionedUserId: string;
      state: "suppress" | "force" | "clear";
    }) => {
      const { itemId, commentId, mentionedUserId, state } = params;
      const overrideKey = `${commentId}::${mentionedUserId}`;
      setPendingMentionOverrideKey(overrideKey);

      try {
        const response = await fetch(
          "/api/attention/unanswered-mentions/manual",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              commentId,
              mentionedUserId,
              state,
            }),
          },
        );

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        const result = (payload as {
          success?: boolean;
          result?: {
            manualRequiresResponse: boolean | null;
            manualRequiresResponseAt: string | null;
            manualDecisionIsStale: boolean;
            requiresResponse: boolean | null;
            lastEvaluatedAt: string | null;
          };
          message?: string;
        }) ?? { success: false };

        if (!response.ok || !result.success || !result.result) {
          throw new Error(
            result.message ?? "응답 없는 멘션 상태를 업데이트하지 못했습니다.",
          );
        }

        const classification = result.result;
        const manualEffective = classification.manualDecisionIsStale
          ? null
          : classification.manualRequiresResponse;

        const computeNextAttention = (fallback: boolean) => {
          if (manualEffective === false) {
            return false;
          }
          if (manualEffective === true) {
            return true;
          }
          if (classification.requiresResponse !== null) {
            return classification.requiresResponse;
          }
          return fallback;
        };

        const updateMentionWait = (
          wait: ActivityMentionWait,
        ): ActivityMentionWait => {
          const waitUserId = wait.user?.id ?? wait.userId;
          if (wait.id !== commentId || waitUserId !== mentionedUserId) {
            return wait;
          }

          return {
            ...wait,
            manualRequiresResponse: manualEffective,
            manualRequiresResponseAt:
              classification.manualRequiresResponseAt ?? null,
            manualDecisionIsStale: classification.manualDecisionIsStale,
            classifierEvaluatedAt: classification.lastEvaluatedAt ?? null,
            requiresResponse:
              classification.requiresResponse ?? wait.requiresResponse,
          } satisfies ActivityMentionWait;
        };

        setDetailMap((current) => {
          const existing = current[itemId];
          if (!existing || !existing.item) {
            return current;
          }
          const nextItem: ActivityItem = {
            ...existing.item,
            attention: {
              ...existing.item.attention,
              unansweredMention: computeNextAttention(
                existing.item.attention.unansweredMention,
              ),
            },
            mentionWaits: existing.item.mentionWaits?.map((wait) =>
              updateMentionWait(wait),
            ),
          };

          return {
            ...current,
            [itemId]: {
              ...existing,
              item: nextItem,
            },
          };
        });

        setListData((current) => ({
          ...current,
          items: current.items.map((listItem) => {
            if (listItem.id !== itemId) {
              return listItem;
            }
            return {
              ...listItem,
              attention: {
                ...listItem.attention,
                unansweredMention: computeNextAttention(
                  listItem.attention.unansweredMention,
                ),
              },
              mentionWaits: listItem.mentionWaits?.map((wait) =>
                updateMentionWait(wait),
              ),
            } satisfies ActivityItem;
          }),
        }));

        showNotification(
          state === "suppress"
            ? "이 멘션을 응답 필요 목록에서 제외했습니다."
            : state === "force"
              ? "이 멘션을 응답 필요 목록으로 고정했습니다."
              : "이 멘션에 대한 응답 필요 수동 설정을 해제했습니다.",
        );

        void fetchActivity(applied, {});
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "응답 없는 멘션 상태를 업데이트하지 못했습니다.";
        showNotification(message);
      } finally {
        setPendingMentionOverrideKey(null);
      }
    },
    [applied, fetchActivity, showNotification],
  );

  const handleApplyQuickFilter = useCallback(
    (definition: QuickFilterDefinition) => {
      let nextState = normalizeFilterState({
        ...definition.buildState(draft.perPage),
        page: 1,
      });
      if (definition.id === "my_updates" || definition.id === "my_attention") {
        nextState = removeMentionRole(nextState);
      }
      const nextKey = canonicalizeActivityParams(
        buildSavedFilterPayload(nextState),
      );
      if (nextKey === canonicalDraftKey) {
        return;
      }

      setDraft(nextState);
      setApplied(nextState);
      setTimeout(() => {
        const normalized = normalizeFilterState(nextState);
        setDraft(normalized);
        setApplied(normalized);
      }, 0);
      setSelectedSavedFilterId("");
      setSaveFilterError(null);
      setJumpDate("");
      void fetchActivity(nextState);
    },
    [canonicalDraftKey, draft.perPage, fetchActivity, normalizeFilterState],
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

    const nextState = normalizeFilterState({
      ...definition.buildState(draft.perPage),
      page: 1,
    });
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
    normalizeFilterState,
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
      const nextState = normalizeFilterState(
        buildFilterState(params, perPageDefault),
      );
      setDraft(nextState);
      setApplied(nextState);
      setSelectedSavedFilterId(filter.id);
      setSaveFilterError(null);
      setJumpDate("");
      void fetchActivity(nextState);
    },
    [fetchActivity, normalizeFilterState, perPageDefault],
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
    const base = normalizeFilterState(buildFilterState({}, perPageDefault));
    setDraft(base);
  }, [normalizeFilterState, perPageDefault]);

  const applyDraftFilters = useCallback(() => {
    if (!hasPendingChanges) {
      return;
    }
    const nextState = { ...draft, page: 1 };
    fetchActivity(nextState);
  }, [draft, fetchActivity, hasPendingChanges]);

  const changePage = useCallback(
    (page: number) => {
      if (page < 1 || page === listData.pageInfo.page) {
        return;
      }

      const nextState = { ...applied, page };
      fetchActivity(nextState);
    },
    [applied, fetchActivity, listData.pageInfo.page],
  );

  const persistActivityRowsPreference = useCallback(
    async (perPage: number) => {
      try {
        const response = await fetch("/api/sync/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activityRowsPerPage: perPage }),
        });
        if (!response.ok) {
          let message = "Rows 설정을 저장하지 못했어요.";
          try {
            const payload = (await response.json()) as { message?: string };
            if (payload?.message) {
              message = payload.message;
            }
          } catch {
            // ignore parsing errors
          }
          showNotification(message);
        }
      } catch (error) {
        console.error("Failed to persist activity rows preference", error);
        showNotification("Rows 설정을 저장하지 못했어요.");
      }
    },
    [showNotification],
  );

  const changePerPage = useCallback(
    (perPage: number) => {
      const nextState = { ...applied, perPage, page: 1 };
      setDraft(nextState);
      fetchActivity(nextState);
      void persistActivityRowsPreference(perPage);
    },
    [applied, fetchActivity, persistActivityRowsPreference],
  );

  const jumpToDate = useCallback(() => {
    if (!jumpDate) {
      return;
    }

    const trimmedZone = activeTimezone?.trim();
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

    fetchActivity({ ...applied }, { jumpToDate: effectiveJump });
  }, [activeTimezone, applied, fetchActivity, jumpDate]);

  const loadDetail = useCallback(
    async (id: string) => {
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
          useMentionAi: applied.useMentionAi,
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
    },
    [applied.useMentionAi],
  );
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
            setListData((current) => ({
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

        setListData((current) => ({
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
            setListData((current) => ({
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

        setListData((current) => ({
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
              {formatDateTimeWithSettings(lastSyncCompletedAt) ??
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
                            const wasActive = nextSet.has(option.value);
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
                            let nextAttention = current.attention;
                            let attentionChanged = false;

                            if (!nextCategories.length) {
                              if (
                                wasActive &&
                                current.categories.length === 1 &&
                                current.categories[0] === option.value &&
                                current.attention.length > 0
                              ) {
                                nextAttention = [];
                                attentionChanged = true;
                              }
                            } else {
                              const filteredAttention =
                                filterAttentionByCategories(
                                  current.attention,
                                  nextCategories,
                                );
                              if (
                                !arraysShallowEqual(
                                  current.attention,
                                  filteredAttention,
                                )
                              ) {
                                nextAttention = filteredAttention;
                                attentionChanged = true;
                              }
                            }

                            let nextState: FilterState = {
                              ...current,
                              categories: nextCategories,
                            };
                            if (attentionChanged) {
                              nextState = {
                                ...nextState,
                                attention: nextAttention,
                              };
                            }
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
                      setDraft((current) =>
                        syncPeopleFilters({
                          ...current,
                          attention: [],
                        }),
                      );
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
                    const tooltip = ATTENTION_TOOLTIPS[option.value];
                    const tooltipId = tooltip
                      ? `${attentionTooltipPrefix}-${option.value}`
                      : undefined;
                    return (
                      <Fragment key={option.value}>
                        <TogglePill
                          active={active}
                          variant={variant}
                          ariaDescribedBy={tooltipId}
                          onClick={() => {
                            setDraft((current) => {
                              const nextSet = new Set(current.attention);
                              const wasActive = nextSet.has(option.value);
                              if (wasActive) {
                                nextSet.delete(option.value);
                              } else {
                                nextSet.add(option.value);
                              }
                              let nextAttention = Array.from(nextSet);
                              if (
                                nextAttention.length ===
                                ATTENTION_OPTIONS.length
                              ) {
                                nextAttention = [];
                              }
                              let nextCategories = current.categories;
                              if (!wasActive) {
                                const requiredCategories =
                                  collectRequiredCategoriesFromAttention(
                                    nextAttention,
                                  );
                                nextCategories =
                                  mergeCategoriesWithRequirements(
                                    current.categories,
                                    requiredCategories,
                                  );
                              }
                              let nextState: FilterState = {
                                ...current,
                                attention: nextAttention,
                              };
                              if (
                                !arraysShallowEqual(
                                  nextCategories,
                                  current.categories,
                                )
                              ) {
                                nextState = {
                                  ...nextState,
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
                              }
                              return syncPeopleFilters(nextState);
                            });
                          }}
                        >
                          <span className="flex items-center gap-1">
                            <span>{option.label}</span>
                            {tooltip ? (
                              <span
                                className="group/tooltip relative inline-flex cursor-help items-center text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:text-foreground"
                                aria-hidden="true"
                              >
                                <Info className="h-3 w-3" aria-hidden="true" />
                                <span
                                  id={tooltipId}
                                  role="tooltip"
                                  className="pointer-events-none absolute left-1/2 top-full z-20 w-56 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-visible/tooltip:opacity-100"
                                >
                                  {tooltip}
                                </span>
                              </span>
                            ) : null}
                          </span>
                        </TogglePill>
                        {option.value === "unanswered_mentions" ? (
                          <AiFilterControl
                            checked={draft.useMentionAi}
                            onToggle={() => {
                              setDraft((current) => ({
                                ...current,
                                useMentionAi: !current.useMentionAi,
                              }));
                            }}
                            tooltipId={mentionAiTooltipId}
                            tooltipText={mentionAiTooltipText}
                          />
                        ) : null}
                      </Fragment>
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
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => setShowAdvancedFilters((value) => !value)}
              >
                {showAdvancedFilters ? "숨기기" : "고급 필터 보기"}
              </Button>
              {peopleFiltersLocked && (
                <span className="text-xs text-muted-foreground/80">
                  주의와 구성원이 선택되면 작성자, 담당자, 리뷰어, 멘션된
                  구성원, 코멘터, 리액션 남긴 구성원 항목은 사용자가 제어할 수
                  없습니다.
                </span>
              )}
            </div>
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
                  appliedValues={draft.repositoryIds}
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
                  placeholder="라벨 선택"
                  appliedValues={draft.labelKeys}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, labelKeys: next }))
                  }
                  options={labelOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label="마일스톤"
                  placeholder="마일스톤 선택"
                  appliedValues={draft.milestoneIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, milestoneIds: next }))
                  }
                  options={milestoneOptions}
                  emptyLabel="미적용"
                />
                <MultiSelectInput
                  label={<span className="normal-case">이슈 Type</span>}
                  placeholder="이슈 Type 선택"
                  appliedValues={draft.issueTypeIds}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, issueTypeIds: next }))
                  }
                  options={issueTypeOptions}
                  emptyLabel="미적용"
                  disabled={issueFiltersDisabled}
                />
                <MultiSelectInput
                  label={<span className="normal-case">이슈 Priority</span>}
                  placeholder="Priority 선택"
                  appliedValues={draft.issuePriorities}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      issuePriorities: next as ActivityIssuePriorityFilter[],
                    }))
                  }
                  options={issuePriorityOptions}
                  emptyLabel="미적용"
                  disabled={issueFiltersDisabled}
                />
                <MultiSelectInput
                  label={<span className="normal-case">이슈 Weight</span>}
                  placeholder="Weight 선택"
                  appliedValues={draft.issueWeights}
                  onChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      issueWeights: next as ActivityIssueWeightFilter[],
                    }))
                  }
                  options={issueWeightOptions}
                  emptyLabel="미적용"
                  disabled={issueFiltersDisabled}
                />
                {peopleFiltersLocked && (
                  <div className="md:col-span-3 lg:col-span-3">
                    <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground/80">
                      주의 type과 구성원을 함께 선택하면 사람 필터는 자동으로
                      적용되며 고급 필터에서 수정할 수 없어요.
                    </div>
                  </div>
                )}
                <MultiSelectInput
                  label="작성자"
                  placeholder="@user"
                  appliedValues={draft.authorIds}
                  optionalValues={draft.optionalPersonIds?.authorIds ?? []}
                  onChange={(next) =>
                    setDraft((current) =>
                      updatePeopleRoleValues(current, "authorIds", next),
                    )
                  }
                  onOptionalChange={(next) =>
                    setDraft((current) =>
                      updateOptionalPersonValues(current, "authorIds", next),
                    )
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                  disabled={peopleFiltersLocked}
                  tone={
                    highlightedPeopleRoles.has("authorIds") ? "or" : undefined
                  }
                />
                <MultiSelectInput
                  label="담당자"
                  placeholder="@assignee"
                  appliedValues={draft.assigneeIds}
                  optionalValues={draft.optionalPersonIds?.assigneeIds ?? []}
                  onChange={(next) =>
                    setDraft((current) =>
                      updatePeopleRoleValues(current, "assigneeIds", next),
                    )
                  }
                  onOptionalChange={(next) =>
                    setDraft((current) =>
                      updateOptionalPersonValues(current, "assigneeIds", next),
                    )
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                  disabled={peopleFiltersLocked}
                  tone={
                    highlightedPeopleRoles.has("assigneeIds") ? "or" : undefined
                  }
                />
                <MultiSelectInput
                  label="리뷰어"
                  placeholder="@reviewer"
                  appliedValues={draft.reviewerIds}
                  optionalValues={draft.optionalPersonIds?.reviewerIds ?? []}
                  onChange={(next) =>
                    setDraft((current) =>
                      updatePeopleRoleValues(current, "reviewerIds", next),
                    )
                  }
                  onOptionalChange={(next) =>
                    setDraft((current) =>
                      updateOptionalPersonValues(current, "reviewerIds", next),
                    )
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                  disabled={prFiltersDisabled || peopleFiltersLocked}
                  tone={
                    highlightedPeopleRoles.has("reviewerIds") ? "or" : undefined
                  }
                />
                <MultiSelectInput
                  label="멘션된 구성원"
                  placeholder="@mention"
                  appliedValues={draft.mentionedUserIds}
                  optionalValues={
                    draft.optionalPersonIds?.mentionedUserIds ?? []
                  }
                  onChange={(next) =>
                    setDraft((current) =>
                      updatePeopleRoleValues(current, "mentionedUserIds", next),
                    )
                  }
                  onOptionalChange={(next) =>
                    setDraft((current) =>
                      updateOptionalPersonValues(
                        current,
                        "mentionedUserIds",
                        next,
                      ),
                    )
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                  disabled={peopleFiltersLocked}
                  tone={
                    highlightedPeopleRoles.has("mentionedUserIds")
                      ? "or"
                      : undefined
                  }
                />
                <MultiSelectInput
                  label="코멘터"
                  placeholder="@commenter"
                  appliedValues={draft.commenterIds}
                  optionalValues={draft.optionalPersonIds?.commenterIds ?? []}
                  onChange={(next) =>
                    setDraft((current) =>
                      updatePeopleRoleValues(current, "commenterIds", next),
                    )
                  }
                  onOptionalChange={(next) =>
                    setDraft((current) =>
                      updateOptionalPersonValues(current, "commenterIds", next),
                    )
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                  disabled={peopleFiltersLocked}
                  tone={
                    highlightedPeopleRoles.has("commenterIds")
                      ? "or"
                      : undefined
                  }
                />
                <MultiSelectInput
                  label="리액션 남긴 구성원"
                  placeholder="@reactor"
                  appliedValues={draft.reactorIds}
                  optionalValues={draft.optionalPersonIds?.reactorIds ?? []}
                  onChange={(next) =>
                    setDraft((current) =>
                      updatePeopleRoleValues(current, "reactorIds", next),
                    )
                  }
                  onOptionalChange={(next) =>
                    setDraft((current) =>
                      updateOptionalPersonValues(current, "reactorIds", next),
                    )
                  }
                  options={userOptions}
                  emptyLabel="미적용"
                  disabled={peopleFiltersLocked}
                  tone={
                    highlightedPeopleRoles.has("reactorIds") ? "or" : undefined
                  }
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
                <Label
                  className={cn(
                    "text-xs font-semibold uppercase text-foreground",
                    prFiltersDisabled && "text-muted-foreground/70",
                  )}
                >
                  PR 상태
                </Label>
                <TogglePill
                  active={prStatusesAllSelected}
                  variant={prStatusesAllSelected ? "active" : "inactive"}
                  onClick={() =>
                    setDraft((current) => ({ ...current, prStatuses: [] }))
                  }
                  disabled={prFiltersDisabled}
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
                      disabled={prFiltersDisabled}
                    >
                      {option.label}
                    </TogglePill>
                  );
                })}
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-2 h-4 border-l border-border/50",
                    issueFiltersDisabled && "opacity-40",
                  )}
                />
                <Label
                  className={cn(
                    "text-xs font-semibold uppercase text-foreground",
                    issueFiltersDisabled && "text-muted-foreground/70",
                  )}
                >
                  이슈 상태
                </Label>
                <TogglePill
                  active={issueBaseStatusesAllSelected}
                  variant={issueBaseStatusesAllSelected ? "active" : "inactive"}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      issueBaseStatuses: [],
                    }))
                  }
                  disabled={issueFiltersDisabled}
                >
                  미적용
                </TogglePill>
                {ISSUE_BASE_STATUS_OPTIONS.map((option) => {
                  const active = draft.issueBaseStatuses.includes(option.value);
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
                          const nextSet = new Set(current.issueBaseStatuses);
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
                      disabled={issueFiltersDisabled}
                    >
                      {option.label}
                    </TogglePill>
                  );
                })}
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-2 h-4 border-l border-border/50",
                    issueFiltersDisabled && "opacity-40",
                  )}
                />
                <Label
                  className={cn(
                    "text-xs font-semibold uppercase text-foreground",
                    issueFiltersDisabled && "text-muted-foreground/70",
                  )}
                >
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
                  disabled={issueFiltersDisabled}
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
                      disabled={issueFiltersDisabled}
                    >
                      {label}
                    </TogglePill>
                  );
                })}
              </div>
              <div className="flex flex-col gap-4 md:flex-row md:flex-nowrap md:gap-6 md:overflow-x-auto">
                <div
                  className={cn(
                    "flex-1 min-w-[200px] space-y-2",
                    issueFiltersDisabled && "opacity-60",
                  )}
                >
                  <Label className="text-xs font-semibold text-foreground">
                    정체 Backlog 이슈 기준일
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={draft.thresholds.backlogIssueDays}
                    disabled={issueFiltersDisabled}
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
                </div>
                <div
                  className={cn(
                    "flex-1 min-w-[200px] space-y-2",
                    issueFiltersDisabled && "opacity-60",
                  )}
                >
                  <Label className="text-xs font-semibold text-foreground">
                    정체 In Progress 이슈 기준일
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={draft.thresholds.stalledIssueDays}
                    disabled={issueFiltersDisabled}
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
                <div
                  className={cn(
                    "flex-1 min-w-[200px] space-y-2",
                    prFiltersDisabled && "opacity-60",
                  )}
                >
                  <Label className="text-xs font-semibold text-foreground">
                    업데이트 없는 PR 기준일
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={draft.thresholds.idlePrDays}
                    disabled={prFiltersDisabled}
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
                <div
                  className={cn(
                    "flex-1 min-w-[200px] space-y-2",
                    prFiltersDisabled && "opacity-60",
                  )}
                >
                  <Label className="text-xs font-semibold text-foreground">
                    응답 없는 리뷰 기준일
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={draft.thresholds.reviewRequestDays}
                    disabled={prFiltersDisabled}
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
                </div>
                <div className="flex-1 min-w-[200px] space-y-2">
                  <Label className="text-xs font-semibold text-foreground">
                    응답 없는 멘션 기준일
                  </Label>
                  <Input
                    type="number"
                    min={5}
                    value={draft.thresholds.unansweredMentionDays}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        thresholds: {
                          ...current.thresholds,
                          unansweredMentionDays: Math.max(
                            5,
                            toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.unansweredMentionDays,
                            ),
                          ),
                        },
                      }))
                    }
                    placeholder="멘션 무응답"
                  />
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
              페이지 {currentPage} / {totalPagesDisplay} (총 {totalCountDisplay}
              건)
            </span>
            <div className="flex items-center gap-2 text-xs uppercase text-foreground">
              <Label className="font-medium" htmlFor={jumpDateInputId}>
                날짜 이동
              </Label>
              <Input
                type="date"
                id={jumpDateInputId}
                value={jumpDate}
                onChange={(event) => setJumpDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && jumpDate) {
                    jumpToDate();
                  }
                }}
                className="h-8 w-auto"
                disabled={isLoading}
              />
              <Button
                type="button"
                variant="outline"
                onClick={jumpToDate}
                disabled={isLoading || !jumpDate}
                className="h-8 px-3 text-xs"
              >
                이동
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">Rows</span>
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
          {!isLoading && visibleItems.length === 0 && (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground/80">
              필터 조건에 맞는 활동이 없습니다.
            </div>
          )}
          {!isLoading && visibleItems.length > 0 && (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
              <div className="space-y-3">
                {visibleItems.map((item) => {
                  const isSelected = openItemId === item.id;
                  const detail = detailMap[item.id] ?? undefined;
                  const isDetailLoading = loadingDetailIds.has(item.id);
                  const badges = buildAttentionBadges(item, {
                    useMentionAi: applied.useMentionAi,
                  });
                  if (item.hasParentIssue) {
                    badges.push({
                      key: "child-issue",
                      label: "Child 이슈",
                      variant: "default",
                    });
                  }
                  if (item.hasSubIssues) {
                    badges.push({
                      key: "parent-issue",
                      label: "Parent 이슈",
                      variant: "default",
                    });
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
                  const statusSourceKey = item.issueProjectStatusSource;
                  const statusSourceLabel =
                    statusSourceKey === "todo_project"
                      ? "To-do 프로젝트"
                      : statusSourceKey === "activity"
                        ? "Activity"
                        : "없음";
                  const displayStatusLabel =
                    currentIssueStatus !== "no_status"
                      ? (ISSUE_STATUS_LABEL_MAP.get(currentIssueStatus) ??
                        currentIssueStatus)
                      : null;
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
                    activeTimezone ?? undefined,
                  );
                  const todoStartDateTimestamp = formatDateTimeWithSettings(
                    item.issueTodoProjectStartDateUpdatedAt,
                  );
                  const canEditStatus =
                    item.type === "issue" && !item.issueProjectStatusLocked;
                  const sourceStatusTimes =
                    statusSourceKey === "todo_project"
                      ? (detail?.todoStatusTimes ?? null)
                      : statusSourceKey === "activity"
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
                  const overlayItem = detail?.item ?? item;
                  const detailComments = detail?.comments ?? [];
                  const commentIdSet = new Set(
                    detailComments
                      .map((comment) => comment.id?.trim())
                      .filter((value): value is string => Boolean(value)),
                  );
                  const mentionWaits = overlayItem.mentionWaits ?? [];
                  const mentionWaitsByCommentId = new Map<
                    string,
                    ActivityMentionWait[]
                  >();
                  const orphanMentionWaits: ActivityMentionWait[] = [];

                  mentionWaits.forEach((wait) => {
                    const commentKey = wait.id?.trim();
                    if (commentKey && commentIdSet.has(commentKey)) {
                      const existing = mentionWaitsByCommentId.get(commentKey);
                      if (existing) {
                        existing.push(wait);
                      } else {
                        mentionWaitsByCommentId.set(commentKey, [wait]);
                      }
                      return;
                    }
                    orphanMentionWaits.push(wait);
                  });

                  const mentionControlsProps =
                    mentionWaits.length > 0
                      ? {
                          byCommentId: Object.fromEntries(
                            mentionWaitsByCommentId.entries(),
                          ) as Record<string, ActivityMentionWait[]>,
                          canManageMentions: currentUserIsAdmin,
                          pendingOverrideKey: pendingMentionOverrideKey,
                          onUpdateMentionOverride: handleMentionOverride,
                          detailItemId: overlayItem.id,
                        }
                      : undefined;
                  const badgeExtras = null;
                  const linkedPullRequestsInline =
                    item.linkedPullRequests.length > 0
                      ? renderLinkedReferenceInline({
                          label: "연결된 PR",
                          type: "pull_request",
                          entries: item.linkedPullRequests.map((pr) =>
                            buildLinkedPullRequestSummary(pr),
                          ),
                          maxItems: 2,
                        })
                      : null;
                  const linkedIssuesInline =
                    item.linkedIssues.length > 0
                      ? renderLinkedReferenceInline({
                          label: "연결된 이슈",
                          type: "issue",
                          entries: item.linkedIssues.map((issue) =>
                            buildLinkedIssueSummary(issue),
                          ),
                          maxItems: 2,
                        })
                      : null;
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
                              <div className="flex flex-col gap-1 text-xs text-foreground/90">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  {metrics.map((metric) => (
                                    <span key={metric.key}>
                                      {metric.content}
                                    </span>
                                  ))}
                                  {item.author && (
                                    <span>
                                      작성자{" "}
                                      {avatarFallback(item.author) ?? "-"}
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
                                      {item.milestone.title ??
                                        item.milestone.id}
                                    </span>
                                  )}
                                  {item.type === "issue" &&
                                    displayStatusLabel && (
                                      <span
                                        className={PROJECT_FIELD_BADGE_CLASS}
                                      >
                                        {displayStatusLabel}
                                      </span>
                                    )}
                                  {item.type === "issue" &&
                                    todoPriorityLabel !== "-" && (
                                      <span
                                        className={PROJECT_FIELD_BADGE_CLASS}
                                      >
                                        {todoPriorityLabel}
                                      </span>
                                    )}
                                  {badges.map((badge) => {
                                    const variantClass =
                                      badge.variant === "manual"
                                        ? "border border-slate-300 bg-slate-100 text-slate-700"
                                        : badge.variant === "ai-soft"
                                          ? "border border-sky-300 bg-sky-50 text-sky-700 shadow-[0_0_0.65rem_rgba(56,189,248,0.25)]"
                                          : "bg-amber-100 text-amber-700";
                                    const tooltipId = badge.tooltip
                                      ? `${item.id}-${badge.key}-tooltip`
                                      : undefined;
                                    return (
                                      <span
                                        key={badge.key}
                                        className={cn(
                                          "relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                          variantClass,
                                          badge.tooltip
                                            ? "group cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                            : "",
                                        )}
                                        tabIndex={badge.tooltip ? 0 : undefined}
                                        aria-describedby={tooltipId}
                                      >
                                        {badge.label}
                                        {badge.tooltip ? (
                                          <span
                                            id={tooltipId}
                                            role="tooltip"
                                            className="pointer-events-none absolute left-1/2 top-full z-20 w-60 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                                          >
                                            {badge.tooltip}
                                          </span>
                                        ) : null}
                                      </span>
                                    );
                                  })}
                                  {item.labels.slice(0, 2).map((label) => (
                                    <span
                                      key={label.key}
                                      className="rounded-md bg-muted px-2 py-0.5"
                                    >
                                      {label.name ?? label.key}
                                    </span>
                                  ))}
                                </div>
                                {linkedPullRequestsInline ||
                                linkedIssuesInline ? (
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    {linkedPullRequestsInline}
                                    {linkedIssuesInline}
                                  </div>
                                ) : null}
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
                          badgeExtras={badgeExtras}
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
                                    <div className="space-y-4 leading-relaxed [&_a]:text-slate-700 [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.user-mention]:font-semibold [&_.user-mention]:text-sky-700">
                                      {content}
                                    </div>
                                  );
                                })()}
                                <ReactionSummaryList
                                  reactions={detail.reactions}
                                  className="mt-3"
                                />
                              </div>
                              {orphanMentionWaits.length > 0 ? (
                                <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                                  <h4 className="text-sm font-semibold text-foreground">
                                    응답 없는 멘션
                                  </h4>
                                  <p className="mt-1 text-muted-foreground/70">
                                    댓글 목록에서 확인할 수 없는 멘션이에요.
                                  </p>
                                  <div className="mt-2 space-y-3">
                                    {orphanMentionWaits.map((wait, index) => {
                                      const mentionUserId =
                                        wait.user?.id ?? wait.userId ?? "";
                                      const mentionHandle =
                                        wait.user?.name ??
                                        (wait.user?.login
                                          ? `@${wait.user.login}`
                                          : mentionUserId);
                                      const aiStatus =
                                        wait.requiresResponse === false
                                          ? "AI 판단: 응답 요구 아님"
                                          : wait.requiresResponse === true
                                            ? "AI 판단: 응답 필요"
                                            : "AI 판단: 정보 없음";
                                      const aiStatusClass =
                                        wait.requiresResponse === false
                                          ? "text-amber-600"
                                          : "text-muted-foreground/70";
                                      const manualState =
                                        wait.manualRequiresResponse === false
                                          ? "suppress"
                                          : wait.manualRequiresResponse === true
                                            ? "force"
                                            : null;
                                      const manualTimestamp =
                                        wait.manualRequiresResponseAt
                                          ? formatDateTimeWithSettings(
                                              wait.manualRequiresResponseAt,
                                            )
                                          : null;
                                      const mentionKey = `${wait.id}::${mentionUserId}`;

                                      return (
                                        <div
                                          key={`${wait.id}-${mentionUserId || index}`}
                                          className="rounded-md border border-border/60 bg-background px-3 py-2"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-3 text-foreground">
                                            <div className="flex flex-col gap-1">
                                              <span className="font-semibold">
                                                대상:{" "}
                                                {mentionHandle || "알 수 없음"}
                                              </span>
                                              <span className="text-muted-foreground/70">
                                                언급일:{" "}
                                                {wait.mentionedAt
                                                  ? (formatDateTimeWithSettings(
                                                      wait.mentionedAt,
                                                    ) ?? "-")
                                                  : "-"}
                                              </span>
                                            </div>
                                            <span
                                              className={cn(
                                                "text-xs font-medium",
                                                aiStatusClass,
                                              )}
                                            >
                                              {aiStatus}
                                            </span>
                                          </div>
                                          {wait.manualDecisionIsStale && (
                                            <p className="mt-1 text-[11px] text-amber-600">
                                              최근 분류 이후 관리자 설정이 다시
                                              필요합니다.
                                            </p>
                                          )}
                                          {manualTimestamp &&
                                            !wait.manualDecisionIsStale && (
                                              <p className="mt-1 text-[11px] text-muted-foreground/70">
                                                관리자 설정: {manualTimestamp}
                                              </p>
                                            )}
                                          {currentUserIsAdmin &&
                                          mentionUserId ? (
                                            <div className="mt-2">
                                              <MentionOverrideControls
                                                value={manualState}
                                                pending={
                                                  pendingMentionOverrideKey ===
                                                  mentionKey
                                                }
                                                onChange={(next) => {
                                                  void handleMentionOverride({
                                                    itemId: item.id,
                                                    commentId: wait.id,
                                                    mentionedUserId:
                                                      mentionUserId,
                                                    state: next,
                                                  });
                                                }}
                                              />
                                            </div>
                                          ) : null}
                                          {!mentionUserId && (
                                            <p className="mt-2 text-[11px] text-muted-foreground">
                                              멘션된 사용자를 확인할 수 없어
                                              관리자 설정을 적용할 수 없습니다.
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                              <ActivityCommentSection
                                comments={detailComments}
                                timezone={activeTimezone}
                                dateTimeFormat={activeDateTimeFormat}
                                mentionControls={mentionControlsProps}
                              />
                              {item.type === "issue" &&
                              item.linkedPullRequests.length > 0 ? (
                                <div className="space-y-2 text-xs">
                                  <h4 className="font-semibold text-muted-foreground/85">
                                    연결된 PR
                                  </h4>
                                  <ul className="space-y-1">
                                    {item.linkedPullRequests.map((linked) => {
                                      const summary =
                                        buildLinkedPullRequestSummary(linked);
                                      return (
                                        <li key={`linked-pr-${linked.id}`}>
                                          {linked.url ? (
                                            <a
                                              href={linked.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="reference-link"
                                            >
                                              {summary.label}
                                            </a>
                                          ) : (
                                            <span>{summary.label}</span>
                                          )}
                                          {summary.status ? (
                                            <span className="text-muted-foreground/70">
                                              {` · ${summary.status}`}
                                            </span>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              ) : null}
                              {item.type === "pull_request" &&
                              item.linkedIssues.length > 0 ? (
                                <div className="space-y-2 text-xs">
                                  <h4 className="font-semibold text-muted-foreground/85">
                                    연결된 이슈
                                  </h4>
                                  <ul className="space-y-1">
                                    {item.linkedIssues.map((linked) => {
                                      const summary =
                                        buildLinkedIssueSummary(linked);
                                      return (
                                        <li key={`linked-issue-${linked.id}`}>
                                          {linked.url ? (
                                            <a
                                              href={linked.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="reference-link"
                                            >
                                              {summary.label}
                                            </a>
                                          ) : (
                                            <span>{summary.label}</span>
                                          )}
                                          {summary.status ? (
                                            <span className="text-muted-foreground/70">
                                              {` · ${summary.status}`}
                                            </span>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              ) : null}
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
                                                  className="reference-link"
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
                                                  className="reference-link"
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
            페이지 {currentPage} / {totalPagesDisplay}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => changePage(currentPage - 1)}
              disabled={isLoading || !canGoPrev}
            >
              이전
            </Button>
            <Button
              variant="outline"
              onClick={() => changePage(currentPage + 1)}
              disabled={isLoading || !canGoNext}
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
          timezone={activeTimezone ?? null}
          dateTimeFormat={activeDateTimeFormat}
        />
      ) : null}
    </div>
  );
}
