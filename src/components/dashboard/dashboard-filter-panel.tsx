"use client";

import { DateTime } from "luxon";
import { useCallback, useId, useMemo } from "react";
import type { FilterState } from "@/components/dashboard/use-dashboard-analytics";
import { Button } from "@/components/ui/button";
import { PickerInput } from "@/components/ui/picker-input";
import {
  buildRangeFromPreset,
  fromDateInputValue,
  PRESETS,
  type TimePresetKey,
  toDateInputValue,
} from "@/lib/dashboard/date-range";
import type { DashboardAnalytics, WeekStart } from "@/lib/dashboard/types";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

type DashboardFilterPanelProps = {
  filters: FilterState;
  appliedFilters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onApply: () => void;
  hasPendingChanges: boolean;
  allowApplyWithoutChanges?: boolean;
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
  appliedFilters,
  setFilters,
  onApply,
  hasPendingChanges,
  allowApplyWithoutChanges = false,
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

  const hasPersonSelector = showPersonSelector && contributors.length > 0;

  const panelSectionClass =
    "flex h-full flex-col gap-4 rounded-xl border border-border/50 bg-card p-4 text-sm shadow-sm";
  const sectionLabelClass =
    "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const emphasizedSectionLabelClass = sectionLabelClass.replace(
    "text-muted-foreground",
    "text-foreground",
  );
  const helperTextClass = "text-xs text-muted-foreground";
  const gridClassName = hasPersonSelector
    ? "grid gap-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-5"
    : "grid gap-4 md:grid-cols-3 xl:grid-cols-3 xl:gap-5";

  const presetLabel =
    PRESETS.find((preset) => preset.key === appliedFilters.preset)?.label ??
    "사용자 지정";
  const hasPendingRangeChange =
    filters.preset !== appliedFilters.preset ||
    filters.start !== appliedFilters.start ||
    filters.end !== appliedFilters.end;
  const pendingStatusMessage = hasPendingChanges
    ? hasPendingRangeChange
      ? "기간 변경 사항이 아직 적용되지 않았습니다."
      : "필터 변경 사항이 아직 적용되지 않았습니다."
    : "";

  const previewRange = useMemo(() => {
    if (!hasPendingRangeChange) {
      return null;
    }

    const startDate = DateTime.fromISO(filters.start, {
      zone: "utc",
    }).startOf("day");
    const endDate = DateTime.fromISO(filters.end, {
      zone: "utc",
    }).endOf("day");

    if (!startDate.isValid || !endDate.isValid || endDate < startDate) {
      return null;
    }

    const intervalDays = Math.max(
      1,
      Math.floor(endDate.diff(startDate, "days").days) + 1,
    );

    const buildShiftedRange = (offset: number) => {
      const offsetDays = intervalDays * offset;
      const shiftedStart = startDate.minus({ days: offsetDays });
      const shiftedEnd = endDate.minus({ days: offsetDays });
      return {
        start: shiftedStart.toUTC().toISO(),
        end: shiftedEnd.toUTC().toISO(),
      };
    };

    return {
      current: buildShiftedRange(0),
      previous: [
        { label: "이전 기간", ...buildShiftedRange(1) },
        { label: "2회 전 기간", ...buildShiftedRange(2) },
        { label: "3회 전 기간", ...buildShiftedRange(3) },
        { label: "4회 전 기간", ...buildShiftedRange(4) },
      ],
    };
  }, [filters.end, filters.start, hasPendingRangeChange]);

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
      <div className={gridClassName}>
        <div className={panelSectionClass}>
          <div className="flex flex-col gap-1">
            <span className={emphasizedSectionLabelClass}>기간</span>
            <p className={helperTextClass}>
              사전 설정으로 빠르게 기간을 전환하세요.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-inner">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
              현재 적용 중
            </span>
            <span className="text-xs font-medium text-foreground">
              {presetLabel}
            </span>
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
              <div className="flex flex-col gap-1">
                <label className={helperTextClass} htmlFor={customStartId}>
                  시작일
                </label>
                <PickerInput
                  id={customStartId}
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
                  pickerButtonLabel="달력 열기"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className={helperTextClass} htmlFor={customEndId}>
                  종료일
                </label>
                <PickerInput
                  id={customEndId}
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
                  pickerButtonLabel="달력 열기"
                />
              </div>
            </div>
          )}
        </div>

        <div className={panelSectionClass}>
          <div className="flex flex-col gap-1">
            <span className={sectionLabelClass}>기간 요약</span>
            <p className={helperTextClass}>
              현재 적용된 기간과 선택한 기간의 차이를 비교해 보세요.
            </p>
          </div>
          <div className="flex flex-col gap-4 pt-1">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                현재 적용됨
              </p>
              <dl className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <dt className={helperTextClass}>현재 기간</dt>
                  <dd className="font-medium">
                    {toDateInputValue(range.start, timeZone)} ~{" "}
                    {toDateInputValue(range.end, timeZone)}
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
            {previewRange && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm shadow-inner">
                <p className="text-xs font-semibold text-primary">미리보기</p>
                <dl className="mt-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <dt className={helperTextClass}>선택된 기간</dt>
                    <dd className="font-medium">
                      {toDateInputValue(previewRange.current.start, timeZone)} ~{" "}
                      {toDateInputValue(previewRange.current.end, timeZone)}
                    </dd>
                  </div>
                  {previewRange.previous.map((period) => (
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
                </dl>
              </div>
            )}
          </div>
        </div>

        <div className={panelSectionClass}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className={emphasizedSectionLabelClass}>저장소</span>
              <p className={helperTextClass}>
                관심 있는 저장소를 선택해서 집중해 보세요.
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
            여러 저장소를 선택하려면 ⌘/Ctrl 키를 누른 상태에서 선택하세요.
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
      </div>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
          {pendingStatusMessage && (
            <p className="text-xs text-muted-foreground sm:text-right">
              {pendingStatusMessage}
            </p>
          )}
          <div className="flex items-center gap-3 sm:justify-end">
            <Button
              type="button"
              onClick={onApply}
              disabled={
                isLoading || (!hasPendingChanges && !allowApplyWithoutChanges)
              }
              className="w-full sm:w-auto"
            >
              {isLoading ? "갱신 중..." : "필터 적용"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
