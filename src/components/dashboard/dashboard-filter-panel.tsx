"use client";

import { useCallback } from "react";
import {
  buildRangeFromPreset,
  fromDateInputValue,
  PRESETS,
  type TimePresetKey,
  toDateInputValue,
} from "@/components/dashboard/dashboard-filters";
import type { FilterState } from "@/components/dashboard/use-dashboard-analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DashboardAnalytics } from "@/lib/dashboard/types";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

type DashboardFilterPanelProps = {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onApply: () => void;
  isLoading: boolean;
  error: string | null;
  repositories: RepositoryProfile[];
  contributors: UserProfile[];
  range: DashboardAnalytics["range"];
  showPersonSelector?: boolean;
  timeZone: string;
};

export function DashboardFilterPanel({
  filters,
  setFilters,
  onApply,
  isLoading,
  error,
  repositories,
  contributors,
  range,
  showPersonSelector = true,
  timeZone,
}: DashboardFilterPanelProps) {
  const allRepositoryIds = repositories.map((repo) => repo.id);
  const allReposSelected =
    allRepositoryIds.length > 0 &&
    allRepositoryIds.every((repoId) => filters.repositoryIds.includes(repoId));

  const handlePresetChange = useCallback(
    (preset: TimePresetKey) => {
      if (preset === "custom") {
        setFilters((current) => ({ ...current, preset }));
        return;
      }

      const computed = buildRangeFromPreset(preset, timeZone);
      setFilters((current) => ({
        ...current,
        preset,
        start: computed?.start ?? current.start,
        end: computed?.end ?? current.end,
      }));
    },
    [setFilters, timeZone],
  );

  const handleRepoSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    setFilters((current) => ({ ...current, repositoryIds: values }));
  };

  const handleSelectAllRepositories = () => {
    setFilters((current) => ({ ...current, repositoryIds: allRepositoryIds }));
  };

  const handlePersonSelection = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const value = event.target.value;
    setFilters((current) => ({
      ...current,
      personId: value === "" ? null : value,
    }));
  };

  return (
    <div className="grid gap-4 rounded-lg border border-border/60 bg-background/60 p-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-xs uppercase text-muted-foreground">
          기간 선택
        </span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              variant={filters.preset === preset.key ? "default" : "secondary"}
              size="sm"
              onClick={() => handlePresetChange(preset.key)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        {filters.preset === "custom" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={toDateInputValue(filters.start, timeZone)}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  preset: "custom",
                  start: fromDateInputValue(
                    event.target.value,
                    timeZone,
                    "start",
                  ),
                }))
              }
            />
            <Input
              type="date"
              value={toDateInputValue(filters.end, timeZone)}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  preset: "custom",
                  end: fromDateInputValue(event.target.value, timeZone, "end"),
                }))
              }
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-2">
          <span className="text-xs uppercase text-muted-foreground">
            리포지토리 필터
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <select
              multiple
              value={filters.repositoryIds}
              onChange={handleRepoSelection}
              className="h-32 w-full flex-1 rounded-md border border-border/60 bg-background p-2 text-sm"
            >
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.nameWithOwner ?? repo.name ?? repo.id}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSelectAllRepositories}
              disabled={allReposSelected || allRepositoryIds.length === 0}
            >
              전체 선택
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            여러 리포지토리를 선택하려면 ⌘/Ctrl 키를 누른 상태에서 선택하세요.
          </span>
        </label>
      </div>

      {showPersonSelector && (
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase text-muted-foreground">
              개인 선택
            </span>
            <select
              value={filters.personId ?? ""}
              onChange={handlePersonSelection}
              className="rounded-md border border-border/60 bg-background p-2 text-sm"
            >
              <option value="">전체 구성원</option>
              {contributors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.login ?? person.name ?? person.id}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="flex flex-col justify-between gap-2 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase text-muted-foreground">
            선택된 기간
          </span>
          <span className="font-medium">
            {toDateInputValue(filters.start, timeZone)} ~{" "}
            {toDateInputValue(filters.end, timeZone)}
          </span>
          <span className="text-xs text-muted-foreground">
            이전 기간: {toDateInputValue(range.previousStart, timeZone)} ~{" "}
            {toDateInputValue(range.previousEnd, timeZone)}
          </span>
          <span className="text-xs text-muted-foreground">
            시간대: {timeZone}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={onApply} disabled={isLoading}>
            {isLoading ? "갱신 중..." : "필터 적용"}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
