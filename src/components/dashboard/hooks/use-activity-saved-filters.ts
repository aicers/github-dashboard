"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  canonicalizeActivityParams,
  QUICK_FILTER_DUPLICATE_MESSAGE,
} from "@/components/dashboard/activity/activity-utils";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import {
  buildFilterState,
  buildSavedFilterPayload,
} from "@/lib/activity/filter-state";
import type {
  ActivityListParams,
  ActivitySavedFilter,
} from "@/lib/activity/types";

type UseActivitySavedFiltersParams = {
  initialSavedFiltersLimit: number;
  retryAfterUnauthorized: (
    execute: () => Promise<Response>,
  ) => Promise<Response>;
  perPageDefault: number;
  normalizeFilterState: (state: FilterState) => FilterState;
  quickFilterCanonicalSet: Set<string>;
  draft: FilterState;
  setDraft: Dispatch<SetStateAction<FilterState>>;
  setApplied: Dispatch<SetStateAction<FilterState>>;
  setJumpDate: Dispatch<SetStateAction<string>>;
  fetchActivity: (
    filters: FilterState,
    options?: { jumpToDate?: string | null; previousSync?: string | null },
  ) => Promise<void>;
  showNotification: (message: string) => void;
  canonicalDraftKey: string;
};

export function useActivitySavedFilters({
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
}: UseActivitySavedFiltersParams) {
  const [savedFilters, setSavedFilters] = useState<ActivitySavedFilter[]>([]);
  const [savedFiltersLimit, setSavedFiltersLimit] = useState(
    initialSavedFiltersLimit,
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

  const loadSavedFilters = useCallback(async () => {
    setSavedFiltersLoading(true);
    setSavedFiltersError(null);
    try {
      const response = await retryAfterUnauthorized(() =>
        fetch("/api/activity/filters", {
          cache: "no-store",
        }),
      );
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
          setSavedFiltersLimit(initialSavedFiltersLimit);
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
          : initialSavedFiltersLimit;

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
  }, [initialSavedFiltersLimit, retryAfterUnauthorized]);

  useEffect(() => {
    void loadSavedFilters();
  }, [loadSavedFilters]);

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

  useEffect(() => {
    const matched = savedFilterCanonicalEntries.find(
      (entry) => entry.key === canonicalDraftKey,
    );
    const nextId = matched ? matched.id : "";
    setSelectedSavedFilterId((currentId) =>
      currentId === nextId ? currentId : nextId,
    );
  }, [canonicalDraftKey, savedFilterCanonicalEntries]);

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
    [
      fetchActivity,
      normalizeFilterState,
      perPageDefault,
      setApplied,
      setDraft,
      setJumpDate,
    ],
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

  return {
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
    savedFilterCanonicalEntries,
    loadSavedFilters,
    applySavedFilter,
    saveCurrentFilters,
    renameSavedFilter,
    replaceSavedFilter,
    deleteSavedFilter,
  };
}
