"use client";

import { DateTime } from "luxon";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActivityDetailState } from "@/components/dashboard/hooks/use-activity-detail";
import { useActivityItemActions } from "@/components/dashboard/hooks/use-activity-item-actions";
import { useActivitySavedFilters } from "@/components/dashboard/hooks/use-activity-saved-filters";
import { useSyncStream } from "@/components/dashboard/hooks/use-sync-stream";
import {
  isPageDataStale,
  PageGenerationNotice,
} from "@/components/dashboard/page-generation-notice";
import {
  isUnauthorizedResponse,
  retryOnceAfterUnauthorized,
} from "@/components/dashboard/post-login-auth-recovery";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import {
  buildFilterState,
  buildSavedFilterPayload,
  normalizeSearchParams,
} from "@/lib/activity/filter-state";
import type {
  ActivityFilterOptions,
  ActivityListParams,
  ActivityListResult,
} from "@/lib/activity/types";
import { ActivityFilterPanel } from "./activity/activity-filter-panel";
import { ActivityItemList } from "./activity/activity-item-list";
import {
  applyFiltersToQuery,
  applyPeopleSelection,
  arraysShallowEqual,
  buildQuickFilterDefinitions,
  canonicalizeActivityParams,
  derivePeopleOrModeRoles,
  derivePeopleState,
  ensureValidTaskMode,
  getPeopleRoleValues,
  includesDiscussionCategory,
  includesIssueCategory,
  type MultiSelectOption,
  PEOPLE_ROLE_KEYS,
  PER_PAGE_CHOICES,
  type PeopleRoleKey,
  type QuickFilterDefinition,
  removeMentionRole,
  SAVED_FILTER_LIMIT_DEFAULT,
  sanitizePeopleIds,
  syncPeopleFiltersWithAttention,
} from "./activity/activity-utils";
import {
  formatDateTime,
  ISSUE_STATUS_VALUE_SET,
} from "./activity/detail-shared";

type ActivityViewProps = {
  initialData: ActivityListResult;
  filterOptions: ActivityFilterOptions;
  initialParams: ActivityListParams;
  currentUserId: string | null;
  currentUserIsAdmin: boolean;
  savedFiltersLimit?: number;
};

export function ActivityView({
  initialData,
  filterOptions,
  initialParams,
  currentUserId,
  currentUserIsAdmin,
  savedFiltersLimit: initialSavedFiltersLimit = SAVED_FILTER_LIMIT_DEFAULT,
}: ActivityViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const retryAfterUnauthorized = useCallback(
    (execute: () => Promise<Response>) =>
      retryOnceAfterUnauthorized({
        execute,
        refresh: () => {
          router.refresh();
        },
        shouldRetry: isUnauthorizedResponse,
      }),
    [router],
  );
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

  const userDirectory = useMemo(
    () =>
      Object.fromEntries(
        augmentedUsers.map((user) => [user.id, user] as const),
      ),
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
  const {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem: handleSelectItem,
    closeItem: handleCloseItem,
    updateDetailItem,
    loadDetail,
    pruneStaleItems,
  } = useActivityDetailState({ useMentionAi: applied.useMentionAi });
  const [jumpDate, setJumpDate] = useState(() => {
    const today = DateTime.local().toISODate();
    return today ?? "";
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [automaticSyncActive, setAutomaticSyncActive] = useState(false);
  const savedFilterSelectId = useId();
  const jumpDateInputId = useId();
  const rowsSelectId = useId();
  const attentionTooltipPrefix = useId();
  const mentionAiTooltipId = `${attentionTooltipPrefix}-mention-ai`;
  const mentionAiTooltipText = "응답을 요구한 멘션인지 여부를 AI가 판단합니다.";

  useEffect(() => {
    setDraft((current) => normalizeFilterState(current));
    setApplied((current) => normalizeFilterState(current));
  }, [normalizeFilterState]);

  useSyncStream(
    useCallback((event) => {
      if (event.type === "run-completed" && event.status === "success") {
        setListData((current) => ({
          ...current,
          lastSyncCompletedAt: event.completedAt,
        }));
      }
      const updateAutoSyncState = () => {
        setAutomaticSyncActive(autoSyncRunIdsRef.current.size > 0);
      };
      if (event.type === "run-started" && event.runType === "automatic") {
        if (!autoSyncRunIdsRef.current.has(event.runId)) {
          autoSyncRunIdsRef.current.add(event.runId);
          updateAutoSyncState();
        }
      } else if (event.type === "run-status") {
        if (
          autoSyncRunIdsRef.current.has(event.runId) &&
          event.status !== "running"
        ) {
          autoSyncRunIdsRef.current.delete(event.runId);
          updateAutoSyncState();
        }
      } else if (
        event.type === "run-completed" ||
        event.type === "run-failed"
      ) {
        if (autoSyncRunIdsRef.current.delete(event.runId)) {
          updateAutoSyncState();
        }
      }
    }, []),
  );

  useEffect(() => {
    let canceled = false;
    const loadInitialSyncStatus = async () => {
      try {
        const response = await retryAfterUnauthorized(() =>
          fetch("/api/sync/status", {
            cache: "no-store",
          }),
        );
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          success?: boolean;
          status?: {
            runs?: Array<{
              id: number;
              runType?: string;
              status?: string;
            }>;
          };
        };
        if (!payload?.success || !payload.status?.runs || canceled) {
          return;
        }
        const ids = new Set<number>();
        payload.status.runs.forEach((run) => {
          if (run.runType === "automatic" && run.status === "running") {
            const runId = Number(run.id);
            if (Number.isFinite(runId)) {
              ids.add(runId);
            }
          }
        });
        if (!canceled) {
          autoSyncRunIdsRef.current = ids;
          setAutomaticSyncActive(ids.size > 0);
        }
      } catch {
        // Best-effort only
      }
    };
    void loadInitialSyncStatus();
    return () => {
      canceled = true;
    };
  }, [retryAfterUnauthorized]);

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
  const generatedAt = listData.generatedAt;
  const dataIsStale = useMemo(
    () => isPageDataStale(generatedAt, lastSyncCompletedAt),
    [generatedAt, lastSyncCompletedAt],
  );

  const fetchControllerRef = useRef<AbortController | null>(null);
  const requestCounterRef = useRef(0);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const appliedQuickParamRef = useRef<string | null>(null);
  const autoSyncRunIdsRef = useRef(new Set<number>());

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(listData.items.map((item) => item.id));
    pruneStaleItems(validIds);
  }, [listData.items, pruneStaleItems]);

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

  const quickFilterDefinitions = useMemo<QuickFilterDefinition[]>(
    () => buildQuickFilterDefinitions(currentUserId, allowedUserIds),
    [allowedUserIds, currentUserId],
  );

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

  const allowDiscussionStatuses = useMemo(
    () => includesDiscussionCategory(draft.categories),
    [draft.categories],
  );
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
  const discussionFiltersDisabled = !allowDiscussionStatuses;

  const selectedIssueStatuses = useMemo(
    () => draft.statuses.filter((status) => ISSUE_STATUS_VALUE_SET.has(status)),
    [draft.statuses],
  );

  const issueStatusesAllSelected = selectedIssueStatuses.length === 0;
  const discussionStatusesAllSelected = draft.discussionStatuses.length === 0;
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
    if (allowDiscussionStatuses) {
      return;
    }

    setDraft((current) => {
      if (current.discussionStatuses.length === 0) {
        return current;
      }
      return {
        ...current,
        discussionStatuses: [],
      };
    });

    setApplied((current) => {
      if (current.discussionStatuses.length === 0) {
        return current;
      }
      return {
        ...current,
        discussionStatuses: [],
      };
    });
  }, [allowDiscussionStatuses]);

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
        applyFiltersToQuery(nextState, perPageDefault, resolveLabelKeys);

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
    [perPageDefault, resolveLabelKeys, showNotification],
  );

  const {
    updatingStatusIds,
    updatingProjectFieldIds,
    resyncingIds,
    pendingMentionOverrideKey,
    handleResyncItem,
    handleUpdateIssueStatus,
    handleUpdateProjectField,
    handleMentionOverride,
  } = useActivityItemActions({
    applied,
    fetchActivity,
    loadDetail,
    showNotification,
    updateDetailItem,
    setListData,
  });

  const {
    savedFilters,
    savedFiltersLimit,
    savedFiltersLoading,
    savedFiltersError,
    selectedSavedFilterId,
    setSelectedSavedFilterId,
    saveFilterName,
    setSaveFilterName,
    saveFilterError,
    setSaveFilterError,
    isSavingFilter,
    filtersManagerOpen,
    setFiltersManagerOpen,
    filtersManagerMode,
    setFiltersManagerMode,
    filtersManagerMessage,
    setFiltersManagerMessage,
    filtersManagerError,
    setFiltersManagerError,
    filtersManagerBusyId,
    applySavedFilter,
    saveCurrentFilters,
    renameSavedFilter,
    replaceSavedFilter,
    deleteSavedFilter,
  } = useActivitySavedFilters({
    initialSavedFiltersLimit,
    retryAfterUnauthorized,
    perPageDefault,
    normalizeFilterState,
    quickFilterCanonicalSet,
    draft,
    setDraft,
    setApplied,
    setJumpDate,
    fetchActivity,
    showNotification,
    canonicalDraftKey,
  });

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
      setSaveFilterError(null);
      setJumpDate("");
      void fetchActivity(nextState);
    },
    [
      canonicalDraftKey,
      draft.perPage,
      fetchActivity,
      normalizeFilterState,
      setSaveFilterError,
    ],
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
      const basePath = window.location.pathname;
      const url = nextParams.toString().length
        ? `${basePath}?${nextParams.toString()}`
        : basePath;
      window.history.replaceState(null, "", url);
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
    searchParams,
  ]);

  const resetFilters = useCallback(() => {
    const base = normalizeFilterState(buildFilterState({}, perPageDefault));
    setDraft(base);
  }, [normalizeFilterState, perPageDefault]);

  const applyDraftFilters = useCallback(() => {
    if (!hasPendingChanges && !dataIsStale) {
      return;
    }
    const nextState = { ...draft, page: 1 };
    fetchActivity(nextState);
  }, [dataIsStale, draft, fetchActivity, hasPendingChanges]);

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

  const handleItemKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, id: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelectItem(id);
      }
    },
    [handleSelectItem],
  );

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
          <PageGenerationNotice
            label="Page Generated:"
            generatedAt={generatedAt}
            latestSyncCompletedAt={lastSyncCompletedAt}
            timezone={activeTimezone ?? undefined}
            dateTimeFormat={activeDateTimeFormat}
          />
          {notification ? (
            <span className="text-xs text-foreground/70">{notification}</span>
          ) : null}
        </div>
      </div>

      <ActivityFilterPanel
        draft={draft}
        setDraft={setDraft}
        isLoading={isLoading}
        hasPendingChanges={hasPendingChanges}
        dataIsStale={dataIsStale}
        showAdvancedFilters={showAdvancedFilters}
        setShowAdvancedFilters={setShowAdvancedFilters}
        error={error}
        quickFilterDefinitions={quickFilterDefinitions}
        activeQuickFilterId={activeQuickFilterId}
        onApplyQuickFilter={handleApplyQuickFilter}
        savedFilters={savedFilters}
        savedFiltersLoading={savedFiltersLoading}
        savedFiltersError={savedFiltersError}
        selectedSavedFilterId={selectedSavedFilterId}
        setSelectedSavedFilterId={setSelectedSavedFilterId}
        canSaveMoreFilters={canSaveMoreFilters}
        savedFiltersLimit={savedFiltersLimit}
        filtersManagerOpen={filtersManagerOpen}
        setFiltersManagerOpen={setFiltersManagerOpen}
        filtersManagerMode={filtersManagerMode}
        setFiltersManagerMode={setFiltersManagerMode}
        filtersManagerMessage={filtersManagerMessage}
        setFiltersManagerMessage={setFiltersManagerMessage}
        filtersManagerError={filtersManagerError}
        setFiltersManagerError={setFiltersManagerError}
        filtersManagerBusyId={filtersManagerBusyId}
        saveFilterName={saveFilterName}
        setSaveFilterName={setSaveFilterName}
        saveFilterError={saveFilterError}
        setSaveFilterError={setSaveFilterError}
        isSavingFilter={isSavingFilter}
        applySavedFilter={applySavedFilter}
        saveCurrentFilters={saveCurrentFilters}
        renameSavedFilter={renameSavedFilter}
        replaceSavedFilter={replaceSavedFilter}
        deleteSavedFilter={deleteSavedFilter}
        peopleSelection={peopleSelection}
        peopleSynced={peopleSynced}
        peopleFiltersLocked={peopleFiltersLocked}
        highlightedPeopleRoles={highlightedPeopleRoles}
        handlePeopleChange={handlePeopleChange}
        userOptions={userOptions}
        repositoryOptions={repositoryOptions}
        labelOptions={labelOptions}
        milestoneOptions={milestoneOptions}
        issueTypeOptions={issueTypeOptions}
        issuePriorityOptions={issuePriorityOptions}
        issueWeightOptions={issueWeightOptions}
        allowIssueStatuses={allowIssueStatuses}
        allowDiscussionStatuses={allowDiscussionStatuses}
        allowPullRequestStatuses={allowPullRequestStatuses}
        issueFiltersDisabled={issueFiltersDisabled}
        prFiltersDisabled={prFiltersDisabled}
        discussionFiltersDisabled={discussionFiltersDisabled}
        issueStatusesAllSelected={issueStatusesAllSelected}
        discussionStatusesAllSelected={discussionStatusesAllSelected}
        prStatusesAllSelected={prStatusesAllSelected}
        issueBaseStatusesAllSelected={issueBaseStatusesAllSelected}
        linkedIssueStatesAllSelected={linkedIssueStatesAllSelected}
        applyDraftFilters={applyDraftFilters}
        resetFilters={resetFilters}
        savedFilterSelectId={savedFilterSelectId}
        attentionTooltipPrefix={attentionTooltipPrefix}
        mentionAiTooltipId={mentionAiTooltipId}
        mentionAiTooltipText={mentionAiTooltipText}
        activeTimezone={activeTimezone}
        activeDateTimeFormat={activeDateTimeFormat}
      />

      <ActivityItemList
        listData={listData}
        applied={applied}
        userDirectory={userDirectory}
        isLoading={isLoading}
        openItemId={openItemId}
        detailMap={detailMap}
        loadingDetailIds={loadingDetailIds}
        updatingStatusIds={updatingStatusIds}
        updatingProjectFieldIds={updatingProjectFieldIds}
        resyncingIds={resyncingIds}
        automaticSyncActive={automaticSyncActive}
        currentUserIsAdmin={currentUserIsAdmin}
        pendingMentionOverrideKey={pendingMentionOverrideKey}
        activeTimezone={activeTimezone}
        activeDateTimeFormat={activeDateTimeFormat}
        timezoneTitle={timezoneTitle}
        jumpDate={jumpDate}
        setJumpDate={setJumpDate}
        jumpToDate={jumpToDate}
        perPageDefault={perPageDefault}
        perPageChoices={perPageChoices}
        changePerPage={changePerPage}
        changePage={changePage}
        handleSelectItem={handleSelectItem}
        handleCloseItem={handleCloseItem}
        handleItemKeyDown={handleItemKeyDown}
        handleResyncItem={handleResyncItem}
        handleUpdateIssueStatus={handleUpdateIssueStatus}
        handleUpdateProjectField={handleUpdateProjectField}
        handleMentionOverride={handleMentionOverride}
        formatDateTimeWithSettings={formatDateTimeWithSettings}
        jumpDateInputId={jumpDateInputId}
        rowsSelectId={rowsSelectId}
      />
    </div>
  );
}
