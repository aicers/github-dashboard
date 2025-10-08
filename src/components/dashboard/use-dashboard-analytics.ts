"use client";

import { useCallback, useState } from "react";
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
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  applyFilters: (nextFilters?: FilterState) => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetFilters: FilterState) => {
    setIsLoading(true);
    setError(null);
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
      );
      const data = await response.json();
      if (!data.success) {
        throw new Error(
          data.message ?? "대시보드 데이터를 불러오지 못했습니다.",
        );
      }

      const nextAnalytics = data.analytics as DashboardAnalytics;
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
          ? targetFilters.repositoryIds
          : sanitizedRepoIds;
      const nextPersonId =
        targetFilters.personId &&
        availableContributorIds.has(targetFilters.personId)
          ? targetFilters.personId
          : null;

      setFilters((current) => {
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

        return {
          ...targetFilters,
          start: nextAnalytics.range.start,
          end: nextAnalytics.range.end,
          repositoryIds: nextRepoIds,
          personId: nextPersonId,
        };
      });
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "대시보드 데이터를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
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

  const presets = PRESETS;

  return {
    analytics,
    filters,
    setFilters,
    applyFilters,
    isLoading,
    error,
    presets,
    timeZone,
    weekStart,
  };
}
