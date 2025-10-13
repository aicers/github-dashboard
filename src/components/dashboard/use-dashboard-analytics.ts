"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, type TimePresetKey } from "@/lib/dashboard/date-range";
import type { DashboardAnalytics, WeekStart } from "@/lib/dashboard/types";

export type FilterState = {
  start: string;
  end: string;
  preset: TimePresetKey;
  repositoryIds: string[];
  personId: string | null;
};

export type DashboardAnalyticsState = {
  analytics: DashboardAnalytics;
  filters: FilterState;
  appliedFilters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  applyFilters: (nextFilters?: FilterState) => Promise<void>;
  hasPendingChanges: boolean;
  isLoading: boolean;
  error: string | null;
  presets: typeof PRESETS;
  timeZone: string;
  weekStart: WeekStart;
};

const DEFAULT_PRESET: TimePresetKey = "last_14_days";

function resolveInitialFilters(
  defaultRange: {
    start: string;
    end: string;
  },
  initialAnalytics: DashboardAnalytics,
): FilterState {
  const allRepositoryIds = initialAnalytics.repositories.map((repo) => repo.id);
  return {
    start: defaultRange.start,
    end: defaultRange.end,
    preset: DEFAULT_PRESET,
    repositoryIds: allRepositoryIds,
    personId: null,
  };
}

export function useDashboardAnalytics({
  initialAnalytics,
  defaultRange,
}: {
  initialAnalytics: DashboardAnalytics;
  defaultRange: { start: string; end: string };
}): DashboardAnalyticsState {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [timeZone, setTimeZone] = useState(initialAnalytics.timeZone);
  const [weekStart, setWeekStart] = useState<WeekStart>(
    initialAnalytics.weekStart,
  );
  const [filters, setFilters] = useState<FilterState>(() =>
    resolveInitialFilters(defaultRange, initialAnalytics),
  );
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() =>
    resolveInitialFilters(defaultRange, initialAnalytics),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestCounterRef = useRef(0);
  const latestStartedRequestRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, []);

  const load = useCallback(async (targetFilters: FilterState) => {
    setIsLoading(true);
    setError(null);
    requestCounterRef.current += 1;
    const requestId = requestCounterRef.current;
    latestStartedRequestRef.current = requestId;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const isLatestRequest = (id: number) =>
      latestStartedRequestRef.current === id;

    try {
      const params = new URLSearchParams({
        start: targetFilters.start,
        end: targetFilters.end,
      });
      if (targetFilters.repositoryIds.length) {
        params.set("repos", targetFilters.repositoryIds.join(","));
      }
      if (targetFilters.personId) {
        params.set("person", targetFilters.personId);
      }

      const response = await fetch(
        `/api/dashboard/analytics?${params.toString()}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!data.success) {
        throw new Error(
          data.message ?? "대시보드 데이터를 불러오지 못했습니다.",
        );
      }

      const nextAnalytics = data.analytics as DashboardAnalytics;
      if (!isLatestRequest(requestId)) {
        return;
      }

      setAnalytics(nextAnalytics);
      if (nextAnalytics.timeZone) {
        setTimeZone(nextAnalytics.timeZone);
      }
      if (nextAnalytics.weekStart) {
        setWeekStart(nextAnalytics.weekStart);
      }
      const availableRepoIds = new Set(
        nextAnalytics.repositories.map((repo) => repo.id),
      );
      const availableContributorIds = new Set(
        nextAnalytics.contributors.map((contributor) => contributor.id),
      );
      const sanitizedRepoIds = targetFilters.repositoryIds.filter((id) =>
        availableRepoIds.has(id),
      );
      const nextRepoIds =
        sanitizedRepoIds.length === targetFilters.repositoryIds.length
          ? [...targetFilters.repositoryIds]
          : sanitizedRepoIds;
      const nextPersonId =
        targetFilters.personId &&
        availableContributorIds.has(targetFilters.personId)
          ? targetFilters.personId
          : null;
      const sanitizedTarget: FilterState = {
        start: nextAnalytics.range.start,
        end: nextAnalytics.range.end,
        preset: targetFilters.preset,
        repositoryIds: nextRepoIds,
        personId: nextPersonId,
      };

      setFilters((current) => {
        if (!isLatestRequest(requestId)) {
          return current;
        }
        // Keep any newer in-flight edits if the user changed filters while this request was running.
        if (current !== targetFilters) {
          const filteredRepoIds = current.repositoryIds.filter((id) =>
            availableRepoIds.has(id),
          );
          const repoChanged =
            filteredRepoIds.length !== current.repositoryIds.length;
          const personFromCurrent =
            current.personId && availableContributorIds.has(current.personId)
              ? current.personId
              : null;

          if (!repoChanged && personFromCurrent === current.personId) {
            return current;
          }

          return {
            ...current,
            repositoryIds: repoChanged
              ? filteredRepoIds
              : current.repositoryIds,
            personId: personFromCurrent,
          };
        }

        return sanitizedTarget;
      });
      setAppliedFilters((current) => {
        if (!isLatestRequest(requestId)) {
          return current;
        }
        return sanitizedTarget;
      });
    } catch (fetchError) {
      if (!isLatestRequest(requestId)) {
        return;
      }
      if (
        fetchError instanceof DOMException &&
        fetchError.name === "AbortError"
      ) {
        return;
      }
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "대시보드 데이터를 불러오지 못했습니다.",
      );
    } finally {
      if (isLatestRequest(requestId)) {
        setIsLoading(false);
      }
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    }
  }, []);

  const applyFilters = useCallback(
    async (nextFilters?: FilterState) => {
      const target = nextFilters ?? filters;
      if (nextFilters) {
        setFilters(nextFilters);
      }
      await load(target);
    },
    [filters, load],
  );

  const hasPendingChanges = useMemo(() => {
    return !areFiltersEqual(filters, appliedFilters);
  }, [filters, appliedFilters]);

  const presets = PRESETS;

  return {
    analytics,
    filters,
    appliedFilters,
    setFilters,
    applyFilters,
    hasPendingChanges,
    isLoading,
    error,
    presets,
    timeZone,
    weekStart,
  };
}

function areFiltersEqual(a: FilterState, b: FilterState) {
  if (
    a.start !== b.start ||
    a.end !== b.end ||
    a.preset !== b.preset ||
    a.personId !== b.personId
  ) {
    return false;
  }
  if (a.repositoryIds.length !== b.repositoryIds.length) {
    return false;
  }
  return a.repositoryIds.every((id, index) => id === b.repositoryIds[index]);
}
