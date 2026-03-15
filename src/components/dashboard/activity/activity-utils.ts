import {
  Activity as ActivityIcon,
  AlertTriangle,
  ListTodo,
  type LucideIcon,
  User,
  UserCheck,
} from "lucide-react";
import { ATTENTION_REQUIRED_VALUES } from "@/lib/activity/attention-options";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import {
  buildFilterState,
  buildSavedFilterPayload,
  normalizeSearchParams,
} from "@/lib/activity/filter-state";
import type {
  ActivityAttentionFilter,
  ActivityDiscussionStatusFilter,
  ActivityIssueBaseStatusFilter,
  ActivityItemType as ActivityItemCategory,
  ActivityListParams,
  ActivityPullRequestStatusFilter,
} from "@/lib/activity/types";

export type PeopleRoleKey =
  | "authorIds"
  | "assigneeIds"
  | "reviewerIds"
  | "mentionedUserIds"
  | "commenterIds"
  | "reactorIds"
  | "maintainerIds";

export type MultiSelectOption = {
  value: string;
  label: string;
  description?: string | null;
};

export type QuickFilterDefinition = {
  id: string;
  label: string;
  description: string;
  buildState: (perPage: number) => FilterState;
  icon: LucideIcon;
};

export const ATTENTION_TOOLTIPS: Partial<
  Record<ActivityAttentionFilter, string>
> = {
  issue_backlog:
    "구성원 선택 시, 구성원이 이슈의 해당 저장소 책임자인 항목만 표시합니다.",
  issue_stalled:
    "구성원 선택 시, 구성원이 이슈의 담당자이거나, 담당자 미지정 시 해당 저장소 책임자이거나, 담당자/저장소 미지정 시 작성자인 항목만 표시합니다.",
  pr_reviewer_unassigned:
    "구성원 선택 시, 구성원이 PR의 저장소 책임자 또는 작성자인 항목만 표시합니다.",
  pr_review_stalled:
    "구성원 선택 시, 구성원이 PR의 저장소 책임자 또는 리뷰어인 항목만 표시합니다.",
  pr_merge_delayed:
    "구성원 선택 시, 구성원이 PR의 담당자이거나, 담당자 미지정 시 해당 저장소 책임자인 항목만 표시합니다.",
  review_requests_pending:
    "구성원 선택 시, 구성원이 리뷰 요청을 받은 항목만 표시합니다.",
  unanswered_mentions:
    "구성원 선택 시, 구성원이 멘션된 구성원인 항목만 표시합니다.",
};

export const CATEGORY_OPTIONS: Array<{
  value: ActivityItemCategory;
  label: string;
}> = [
  { value: "discussion", label: "Discussion" },
  { value: "issue", label: "Issue" },
  { value: "pull_request", label: "Pull Request" },
];

export const DISCUSSION_STATUS_OPTIONS: Array<{
  value: ActivityDiscussionStatusFilter;
  label: string;
}> = [
  { value: "discussion_open", label: "Open" },
  { value: "discussion_closed", label: "Closed" },
];

export const PR_STATUS_OPTIONS: Array<{
  value: ActivityPullRequestStatusFilter;
  label: string;
}> = [
  { value: "pr_open", label: "Open" },
  { value: "pr_merged", label: "Merged" },
  { value: "pr_closed", label: "Closed (Unmerged)" },
];

export const ISSUE_BASE_STATUS_OPTIONS: Array<{
  value: ActivityIssueBaseStatusFilter;
  label: string;
}> = [
  { value: "issue_open", label: "Open" },
  { value: "issue_closed", label: "Closed" },
];

export const PER_PAGE_CHOICES = [10, 25, 50];
export const SAVED_FILTER_LIMIT_DEFAULT = 30;
export const QUICK_FILTER_DUPLICATE_MESSAGE =
  "기본 빠른 필터와 동일한 설정은 저장할 수 없어요.";

export const ALL_ACTIVITY_CATEGORIES = CATEGORY_OPTIONS.map(
  (option) => option.value,
) as ActivityItemCategory[];

export const PEOPLE_ROLE_MAP: Record<ActivityItemCategory, PeopleRoleKey[]> = {
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

export const PEOPLE_ROLE_KEYS: PeopleRoleKey[] = [
  "authorIds",
  "assigneeIds",
  "reviewerIds",
  "mentionedUserIds",
  "commenterIds",
  "reactorIds",
  "maintainerIds",
];

export const ATTENTION_ROLE_RULES: Record<
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
  pr_reviewer_unassigned: {
    applied: ["authorIds", "maintainerIds"],
    optional: [],
    cleared: ["mentionedUserIds", "commenterIds", "reactorIds"],
  },
  pr_review_stalled: {
    applied: ["reviewerIds", "maintainerIds"],
    optional: [],
    cleared: ["mentionedUserIds", "commenterIds", "reactorIds"],
  },
  pr_merge_delayed: {
    applied: ["assigneeIds"],
    optional: [],
    cleared: [
      "authorIds",
      "reviewerIds",
      "mentionedUserIds",
      "commenterIds",
      "reactorIds",
    ],
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

export function getPeopleRoleValues(
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

export function setOptionalPersonValues(
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

export function setPeopleRoleValues(
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

  let withOptionalCleared = setOptionalPersonValues(next, role, []);

  if (role === "mentionedUserIds") {
    const ignored = withOptionalCleared.ignoredSyncRoles ?? [];
    if (ignored.length > 0) {
      const filteredIgnored = ignored.filter(
        (entry) => entry !== "mentionedUserIds",
      );
      if (filteredIgnored.length !== ignored.length) {
        withOptionalCleared = {
          ...withOptionalCleared,
          ignoredSyncRoles: filteredIgnored,
        };
      }
    }
  }

  if (shouldClearTaskMode && withOptionalCleared.taskMode === "my_todo") {
    return { ...withOptionalCleared, taskMode: null };
  }
  return withOptionalCleared;
}

export function clearPeopleRoleValues(state: FilterState, role: PeopleRoleKey) {
  if (getPeopleRoleValues(state, role).length > 0) {
    return setPeopleRoleValues(state, role, []);
  }
  return setOptionalPersonValues(state, role, []);
}

export function updatePeopleRoleValues(
  state: FilterState,
  role: PeopleRoleKey,
  values: string[],
): FilterState {
  const nextState = setPeopleRoleValues(state, role, values);
  return syncPeopleFilters(nextState);
}

export function updateOptionalPersonValues(
  state: FilterState,
  role: PeopleRoleKey,
  values: string[],
): FilterState {
  const nextState = setOptionalPersonValues(state, role, values);
  return syncPeopleFilters(nextState);
}

export function removeMentionRole(state: FilterState): FilterState {
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
  const ignored = nextState.ignoredSyncRoles ?? [];
  if (!ignored.includes("mentionedUserIds")) {
    nextState = {
      ...nextState,
      ignoredSyncRoles: [...ignored, "mentionedUserIds"],
    };
  }
  return syncPeopleFilters(nextState);
}

export function hasActiveAttentionFilters(state: FilterState): boolean {
  return state.attention.some((value) => value !== "no_attention");
}

export function collectPeopleSelectionFromRoles(state: FilterState): string[] {
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

export function syncPeopleSelectionFromRoles(state: FilterState): FilterState {
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

export function syncPeopleFiltersWithAttention(
  state: FilterState,
): FilterState {
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

export function syncPeopleFilters(state: FilterState): FilterState {
  const attentionSynced = syncPeopleFiltersWithAttention(state);
  if (hasActiveAttentionFilters(attentionSynced)) {
    return attentionSynced;
  }
  return syncPeopleSelectionFromRoles(attentionSynced);
}

export function isOptionalPeopleEmpty(state: FilterState): boolean {
  return !PEOPLE_ROLE_KEYS.some((role) => {
    const values = state.optionalPersonIds?.[role];
    return Array.isArray(values) && values.length > 0;
  });
}

export const ATTENTION_CATEGORY_MAP = {
  no_attention: [],
  issue_backlog: ["issue"],
  issue_stalled: ["issue"],
  pr_reviewer_unassigned: ["pull_request"],
  pr_review_stalled: ["pull_request"],
  pr_merge_delayed: ["pull_request"],
  review_requests_pending: ["pull_request"],
  unanswered_mentions: [],
} satisfies Record<
  ActivityAttentionFilter,
  ReadonlyArray<ActivityItemCategory>
>;

export function sortCategoriesForDisplay(
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

export function collectRequiredCategoriesFromAttention(
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

export function mergeCategoriesWithRequirements(
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

export function attentionMatchesCategories(
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

export function filterAttentionByCategories(
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

export function includesIssueCategory(categories: ActivityItemCategory[]) {
  return categories.length === 0 || categories.includes("issue");
}

export function includesDiscussionCategory(categories: ActivityItemCategory[]) {
  return categories.length === 0 || categories.includes("discussion");
}

export function arraysShallowEqual(first: string[], second: string[]) {
  if (first.length !== second.length) {
    return false;
  }
  return first.every((value, index) => value === second[index]);
}

export function normalizePeopleIds(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function ensureValidTaskMode(
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

export function resolvePeopleCategories(categories: ActivityItemCategory[]) {
  return categories.length ? categories : ALL_ACTIVITY_CATEGORIES;
}

export function getPeopleRoleTargets(
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

export function derivePeopleState(
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
  const ignoredRoles = new Set(state.ignoredSyncRoles ?? []);
  const targets = Array.from(targetSet).filter((role) => {
    if (ignoredRoles.has(role)) {
      return false;
    }
    return true;
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

export function derivePeopleOrModeRoles(state: FilterState): {
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

export function applyPeopleSelection(
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
      ignoredSyncRoles: [],
    };
  }

  return changed ? syncPeopleFilters(nextState) : state;
}

export function sanitizePeopleIds(
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

export function canonicalizeActivityParams(params: ActivityListParams) {
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

export function applyFiltersToQuery(
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
  const basePath = window.location.pathname;
  const url = query.length ? `${basePath}?${query}` : basePath;
  window.history.replaceState(null, "", url);
}

export function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function avatarFallback(
  user:
    | { login?: string | null; name?: string | null; id: string }
    | null
    | undefined,
) {
  if (!user) {
    return null;
  }
  return user.login ?? user.name ?? user.id;
}

export function buildQuickFilterDefinitions(
  currentUserId: string | null,
  allowedUserIds: Set<string>,
): QuickFilterDefinition[] {
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
      const defaultDiscussionStatuses: ActivityDiscussionStatusFilter[] = [
        "discussion_open",
      ];
      const defaultPrStatuses: ActivityPullRequestStatusFilter[] = ["pr_open"];
      const defaultIssueBaseStatuses: ActivityIssueBaseStatusFilter[] = [
        "issue_open",
      ];
      const defaultProjectStatuses = [
        "no_status",
        "todo",
        "in_progress",
        "pending",
      ] as const;
      let next = buildFilterState({}, perPage);
      roles.forEach((role) => {
        next = setPeopleRoleValues(next, role, selection);
      });
      next = syncPeopleFilters(next);
      const baseState = {
        ...next,
        taskMode: "my_todo" as const,
        peopleSelection: selection,
        discussionStatuses: [...defaultDiscussionStatuses],
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
}

// Re-export for convenience
export { buildFilterState, buildSavedFilterPayload };
