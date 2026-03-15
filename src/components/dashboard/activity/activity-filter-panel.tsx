"use client";

import { ChevronDown, Info } from "lucide-react";
import { type Dispatch, Fragment, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ATTENTION_OPTIONS } from "@/lib/activity/attention-options";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import { DEFAULT_THRESHOLD_VALUES } from "@/lib/activity/filter-state";
import type {
  ActivityIssuePriorityFilter,
  ActivityIssueWeightFilter,
  ActivityItemType as ActivityItemCategory,
  ActivityLinkedIssueFilter,
  ActivitySavedFilter,
} from "@/lib/activity/types";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import {
  AiFilterControl,
  MultiSelectInput,
  PeopleToggleList,
  QuickFilterButton,
  SavedFiltersManager,
  TogglePill,
} from "./activity-filter-controls";
import {
  ATTENTION_TOOLTIPS,
  applyPeopleSelection,
  arraysShallowEqual,
  CATEGORY_OPTIONS,
  collectRequiredCategoriesFromAttention,
  DISCUSSION_STATUS_OPTIONS,
  derivePeopleState,
  filterAttentionByCategories,
  ISSUE_BASE_STATUS_OPTIONS,
  type MultiSelectOption,
  mergeCategoriesWithRequirements,
  type PeopleRoleKey,
  PR_STATUS_OPTIONS,
  type QuickFilterDefinition,
  syncPeopleFilters,
  toPositiveInt,
  updateOptionalPersonValues,
  updatePeopleRoleValues,
} from "./activity-utils";
import { ISSUE_STATUS_OPTIONS, ISSUE_STATUS_VALUE_SET } from "./detail-shared";

export type ActivityFilterPanelProps = {
  draft: FilterState;
  setDraft: Dispatch<SetStateAction<FilterState>>;
  isLoading: boolean;
  hasPendingChanges: boolean;
  dataIsStale: boolean;
  showAdvancedFilters: boolean;
  setShowAdvancedFilters: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  // Quick filters
  quickFilterDefinitions: QuickFilterDefinition[];
  activeQuickFilterId: string | null;
  onApplyQuickFilter: (definition: QuickFilterDefinition) => void;
  // Saved filters
  savedFilters: ActivitySavedFilter[];
  savedFiltersLoading: boolean;
  savedFiltersError: string | null;
  selectedSavedFilterId: string;
  setSelectedSavedFilterId: Dispatch<SetStateAction<string>>;
  canSaveMoreFilters: boolean;
  savedFiltersLimit: number;
  filtersManagerOpen: boolean;
  setFiltersManagerOpen: Dispatch<SetStateAction<boolean>>;
  filtersManagerMode: "manage" | "save";
  setFiltersManagerMode: Dispatch<SetStateAction<"manage" | "save">>;
  filtersManagerMessage: string | null;
  setFiltersManagerMessage: Dispatch<SetStateAction<string | null>>;
  filtersManagerError: string | null;
  setFiltersManagerError: Dispatch<SetStateAction<string | null>>;
  filtersManagerBusyId: string | null;
  saveFilterName: string;
  setSaveFilterName: Dispatch<SetStateAction<string>>;
  saveFilterError: string | null;
  setSaveFilterError: Dispatch<SetStateAction<string | null>>;
  isSavingFilter: boolean;
  applySavedFilter: (filter: ActivitySavedFilter) => void;
  saveCurrentFilters: () => Promise<void>;
  renameSavedFilter: (
    filter: ActivitySavedFilter,
    name: string,
  ) => Promise<void>;
  replaceSavedFilter: (filter: ActivitySavedFilter) => Promise<void>;
  deleteSavedFilter: (filter: ActivitySavedFilter) => Promise<void>;
  // People
  peopleSelection: string[];
  peopleSynced: boolean;
  peopleFiltersLocked: boolean;
  highlightedPeopleRoles: Set<PeopleRoleKey>;
  handlePeopleChange: (next: string[]) => void;
  // Filter options
  userOptions: MultiSelectOption[];
  repositoryOptions: MultiSelectOption[];
  labelOptions: MultiSelectOption[];
  milestoneOptions: MultiSelectOption[];
  issueTypeOptions: MultiSelectOption[];
  issuePriorityOptions: MultiSelectOption[];
  issueWeightOptions: MultiSelectOption[];
  // Derived booleans
  allowIssueStatuses: boolean;
  allowDiscussionStatuses: boolean;
  allowPullRequestStatuses: boolean;
  issueFiltersDisabled: boolean;
  prFiltersDisabled: boolean;
  discussionFiltersDisabled: boolean;
  issueStatusesAllSelected: boolean;
  discussionStatusesAllSelected: boolean;
  prStatusesAllSelected: boolean;
  issueBaseStatusesAllSelected: boolean;
  linkedIssueStatesAllSelected: boolean;
  // Apply/Reset
  applyDraftFilters: () => void;
  resetFilters: () => void;
  // IDs for a11y
  savedFilterSelectId: string;
  attentionTooltipPrefix: string;
  mentionAiTooltipId: string;
  mentionAiTooltipText: string;
  // Timezone/format
  activeTimezone: string | null;
  activeDateTimeFormat: DateTimeDisplayFormat;
};

export function ActivityFilterPanel({
  draft,
  setDraft,
  isLoading,
  hasPendingChanges,
  dataIsStale,
  showAdvancedFilters,
  setShowAdvancedFilters,
  error,
  quickFilterDefinitions,
  activeQuickFilterId,
  onApplyQuickFilter,
  savedFilters,
  savedFiltersLoading,
  savedFiltersError,
  selectedSavedFilterId,
  setSelectedSavedFilterId,
  canSaveMoreFilters,
  savedFiltersLimit,
  filtersManagerOpen,
  setFiltersManagerOpen,
  filtersManagerMode,
  setFiltersManagerMode,
  filtersManagerMessage,
  setFiltersManagerMessage,
  filtersManagerError,
  setFiltersManagerError,
  filtersManagerBusyId,
  saveFilterName,
  setSaveFilterName,
  saveFilterError,
  setSaveFilterError,
  isSavingFilter,
  applySavedFilter,
  saveCurrentFilters,
  renameSavedFilter,
  replaceSavedFilter,
  deleteSavedFilter,
  peopleSelection,
  peopleSynced,
  peopleFiltersLocked,
  highlightedPeopleRoles,
  handlePeopleChange,
  userOptions,
  repositoryOptions,
  labelOptions,
  milestoneOptions,
  issueTypeOptions,
  issuePriorityOptions,
  issueWeightOptions,
  allowIssueStatuses,
  issueFiltersDisabled,
  prFiltersDisabled,
  discussionFiltersDisabled,
  issueStatusesAllSelected,
  discussionStatusesAllSelected,
  prStatusesAllSelected,
  issueBaseStatusesAllSelected,
  linkedIssueStatesAllSelected,
  applyDraftFilters,
  resetFilters,
  savedFilterSelectId,
  attentionTooltipPrefix,
  mentionAiTooltipId,
  mentionAiTooltipText,
  activeTimezone,
  activeDateTimeFormat,
}: ActivityFilterPanelProps) {
  return (
    <>
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
                    onClick={() => onApplyQuickFilter(definition)}
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
                disabled={isLoading || (!hasPendingChanges && !dataIsStale)}
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
                <div
                  className={cn(
                    "space-y-2",
                    issueFiltersDisabled && "opacity-60",
                  )}
                >
                  <Label
                    className={cn(
                      "text-xs font-semibold uppercase text-foreground",
                      issueFiltersDisabled && "text-muted-foreground/70",
                    )}
                  >
                    이슈 연결
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <TogglePill
                      active={linkedIssueStatesAllSelected}
                      variant={
                        linkedIssueStatesAllSelected ? "active" : "inactive"
                      }
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
                              const nextSet = new Set(
                                current.linkedIssueStates,
                              );
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
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label
                  className={cn(
                    "text-xs font-semibold uppercase text-foreground",
                    discussionFiltersDisabled && "text-muted-foreground/70",
                  )}
                >
                  <span className="normal-case">Discussion 상태</span>
                </Label>
                <TogglePill
                  active={discussionStatusesAllSelected}
                  variant={
                    discussionStatusesAllSelected ? "active" : "inactive"
                  }
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      discussionStatuses: [],
                    }))
                  }
                  disabled={discussionFiltersDisabled}
                >
                  미적용
                </TogglePill>
                {DISCUSSION_STATUS_OPTIONS.map((option) => {
                  const active = draft.discussionStatuses.includes(
                    option.value,
                  );
                  const variant = discussionStatusesAllSelected
                    ? "muted"
                    : active
                      ? "active"
                      : "inactive";
                  return (
                    <TogglePill
                      key={`advanced-discussion-status-${option.value}`}
                      active={active}
                      variant={variant}
                      onClick={() => {
                        setDraft((current) => {
                          const nextSet = new Set(current.discussionStatuses);
                          if (nextSet.has(option.value)) {
                            nextSet.delete(option.value);
                          } else {
                            nextSet.add(option.value);
                          }
                          return {
                            ...current,
                            discussionStatuses: Array.from(nextSet),
                          };
                        });
                      }}
                      disabled={discussionFiltersDisabled}
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
                    prFiltersDisabled && "opacity-40",
                  )}
                />
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
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-foreground">
                  기준일
                </Label>
                <div className="grid gap-4 md:grid-cols-4 md:gap-6 lg:grid-cols-7">
                  <div
                    className={cn(
                      "min-w-0 space-y-2",
                      issueFiltersDisabled && "opacity-60",
                    )}
                  >
                    <Label className="text-xs font-semibold text-foreground">
                      정체된 Backlog 이슈
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
                      "min-w-0 space-y-2",
                      issueFiltersDisabled && "opacity-60",
                    )}
                  >
                    <Label className="text-xs font-semibold text-foreground">
                      정체된 In Progress 이슈
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
                      "min-w-0 space-y-2",
                      prFiltersDisabled && "opacity-60",
                    )}
                  >
                    <Label className="text-xs font-semibold text-foreground">
                      리뷰어 미지정 PR
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.reviewerUnassignedPrDays}
                      disabled={prFiltersDisabled}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            reviewerUnassignedPrDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.reviewerUnassignedPrDays,
                            ),
                          },
                        }))
                      }
                      placeholder="리뷰어 미지정"
                    />
                  </div>
                  <div
                    className={cn(
                      "min-w-0 space-y-2",
                      prFiltersDisabled && "opacity-60",
                    )}
                  >
                    <Label className="text-xs font-semibold text-foreground">
                      리뷰 정체 PR
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.reviewStalledPrDays}
                      disabled={prFiltersDisabled}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            reviewStalledPrDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.reviewStalledPrDays,
                            ),
                          },
                        }))
                      }
                      placeholder="리뷰 정체"
                    />
                  </div>
                  <div
                    className={cn(
                      "min-w-0 space-y-2",
                      prFiltersDisabled && "opacity-60",
                    )}
                  >
                    <Label className="text-xs font-semibold text-foreground">
                      머지 지연 PR
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={draft.thresholds.mergeDelayedPrDays}
                      disabled={prFiltersDisabled}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          thresholds: {
                            ...current.thresholds,
                            mergeDelayedPrDays: toPositiveInt(
                              event.target.value,
                              DEFAULT_THRESHOLD_VALUES.mergeDelayedPrDays,
                            ),
                          },
                        }))
                      }
                      placeholder="머지 지연"
                    />
                  </div>
                  <div
                    className={cn(
                      "min-w-0 space-y-2",
                      prFiltersDisabled && "opacity-60",
                    )}
                  >
                    <Label className="text-xs font-semibold text-foreground">
                      응답 없는 리뷰 요청
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
                  <div className="min-w-0 space-y-2">
                    <Label className="text-xs font-semibold text-foreground">
                      응답 없는 멘션
                    </Label>
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
    </>
  );
}
