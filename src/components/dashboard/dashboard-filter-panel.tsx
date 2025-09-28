"use client";

import { useCallback, useId } from "react";
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
import type { DashboardAnalytics, WeekStart } from "@/lib/dashboard/types";
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
  weekStart: WeekStart;
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
  weekStart,
}: DashboardFilterPanelProps) {
  const allRepositoryIds = repositories.map((repo) => repo.id);
  const allReposSelected =
    allRepositoryIds.length > 0 &&
    allRepositoryIds.every((repoId) => filters.repositoryIds.includes(repoId));

  const customStartId = useId();
  const customEndId = useId();

  const handlePresetChange = useCallback(
    (preset: TimePresetKey) => {
      if (preset === "custom") {
        setFilters((current) => ({ ...current, preset }));
        return;
      }

      const computed = buildRangeFromPreset(preset, timeZone, weekStart);
      setFilters((current) => ({
        ...current,
        preset,
        start: computed?.start ?? current.start,
        end: computed?.end ?? current.end,
      }));
    },
    [setFilters, timeZone, weekStart],
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

  const panelSectionClass =
    "flex h-full flex-col gap-4 rounded-xl border border-border/50 bg-card p-4 text-sm shadow-sm";
  const sectionLabelClass =
    "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const helperTextClass = "text-xs text-muted-foreground";
  const actionPanelSpanClass =
    showPersonSelector && contributors.length > 0
      ? ""
      : "md:col-span-2 xl:col-span-2";

  const previousRanges = [
    {
      label: "이전 기간",
      start: range.previousStart,
      end: range.previousEnd,
    },
    {
      label: "2회 전 기간",
      start: range.previous2Start,
      end: range.previous2End,
    },
    {
      label: "3회 전 기간",
      start: range.previous3Start,
      end: range.previous3End,
    },
    {
      label: "4회 전 기간",
      start: range.previous4Start,
      end: range.previous4End,
    },
  ];

  return (
    <section className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm backdrop-blur md:p-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <div className={panelSectionClass}>
          <div className="flex flex-col gap-1">
            <span className={sectionLabelClass}>기간 선택</span>
            <p className={helperTextClass}>
              사전 설정으로 빠르게 기간을 전환하세요.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-3">
            {PRESETS.map((preset) => (
              <Button
                key={preset.key}
                variant={
                  filters.preset === preset.key ? "default" : "secondary"
                }
                size="sm"
                onClick={() => handlePresetChange(preset.key)}
                className="justify-start"
              >
                {preset.label}
              </Button>
            ))}
          </div>
          {filters.preset === "custom" && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <label className="flex flex-col gap-1" htmlFor={customStartId}>
                <span className={helperTextClass}>시작일</span>
                <Input
                  id={customStartId}
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
              </label>
              <label className="flex flex-col gap-1" htmlFor={customEndId}>
                <span className={helperTextClass}>종료일</span>
                <Input
                  id={customEndId}
                  type="date"
                  value={toDateInputValue(filters.end, timeZone)}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      preset: "custom",
                      end: fromDateInputValue(
                        event.target.value,
                        timeZone,
                        "end",
                      ),
                    }))
                  }
                />
              </label>
            </div>
          )}
        </div>

        <div className={panelSectionClass}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className={sectionLabelClass}>리포지토리 필터</span>
              <p className={helperTextClass}>
                관심 있는 리포지토리를 선택해서 집중해 보세요.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSelectAllRepositories}
              disabled={allReposSelected || allRepositoryIds.length === 0}
              className="whitespace-nowrap"
            >
              전체 선택
            </Button>
          </div>
          <select
            multiple
            value={filters.repositoryIds}
            onChange={handleRepoSelection}
            className="min-h-[8.5rem] w-full flex-1 rounded-lg border border-border/60 bg-background p-2 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.nameWithOwner ?? repo.name ?? repo.id}
              </option>
            ))}
          </select>
          <p className={helperTextClass}>
            여러 리포지토리를 선택하려면 ⌘/Ctrl 키를 누른 상태에서 선택하세요.
          </p>
        </div>

        {showPersonSelector && (
          <div className={panelSectionClass}>
            <span className={sectionLabelClass}>개인 선택</span>
            <p className={helperTextClass}>
              특정 구성원의 활동을 살펴보려면 아래에서 선택하세요.
            </p>
            <select
              value={filters.personId ?? ""}
              onChange={handlePersonSelection}
              className="rounded-lg border border-border/60 bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">전체 구성원</option>
              {contributors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.login ?? person.name ?? person.id}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={`${panelSectionClass} ${actionPanelSpanClass}`}>
          <div className="flex flex-col gap-3">
            <span className={sectionLabelClass}>선택된 기간</span>
            <dl className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <dt className={helperTextClass}>현재 기간</dt>
                <dd className="font-medium">
                  {toDateInputValue(filters.start, timeZone)} ~{" "}
                  {toDateInputValue(filters.end, timeZone)}
                </dd>
              </div>
              {previousRanges.map((period) => (
                <div
                  key={period.label}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className={helperTextClass}>{period.label}</dt>
                  <dd className="text-sm text-muted-foreground">
                    {toDateInputValue(period.start, timeZone)} ~{" "}
                    {toDateInputValue(period.end, timeZone)}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <dt className={helperTextClass}>시간대</dt>
                <dd className="text-sm text-muted-foreground">{timeZone}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <Button onClick={onApply} disabled={isLoading} className="w-full">
              {isLoading ? "갱신 중..." : "필터 적용"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
