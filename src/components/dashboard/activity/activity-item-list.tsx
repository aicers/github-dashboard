"use client";

import { ChevronDown } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PickerInput } from "@/components/ui/picker-input";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import type {
  ActivityItem,
  ActivityItemDetail,
  ActivityListResult,
  ActivityMentionWait,
  IssueProjectStatus,
} from "@/lib/activity/types";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import { ActivityDetailOverlay } from "./activity-detail-overlay";
import { ActivityListItemSummary } from "./activity-list-item-summary";
import { avatarFallback, toPositiveInt } from "./activity-utils";
import {
  ActivityCommentSection,
  formatDateOnly,
  formatProjectField,
  ISSUE_MILESTONE_BADGE_CLASS,
  ISSUE_PRIORITY_BADGE_CLASS,
  ISSUE_STATUS_LABEL_MAP,
  ISSUE_STATUS_OPTIONS,
  ISSUE_TYPE_BADGE_CLASS,
  ISSUE_WEIGHT_BADGE_CLASS,
  MentionOverrideControls,
  PROJECT_FIELD_BADGE_CLASS,
  ProjectFieldEditor,
  type ProjectFieldKey,
  ReactionSummaryList,
  renderMarkdownHtml,
  resolveDetailBodyHtml,
  SOURCE_STATUS_KEYS,
} from "./detail-shared";
import {
  buildActivityMetricEntries,
  buildAttentionBadges,
  buildLinkedIssueSummary,
  buildLinkedPullRequestSummary,
  formatRelative,
  renderLinkedReferenceInline,
  resolveActivityIcon,
} from "./shared";

type DetailMap = Record<string, ActivityItemDetail | null | undefined>;

export type UserDirectoryEntry = {
  id: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type ActivityItemListProps = {
  listData: ActivityListResult;
  applied: FilterState;
  userDirectory: Record<string, UserDirectoryEntry>;
  isLoading: boolean;
  openItemId: string | null;
  detailMap: DetailMap;
  loadingDetailIds: Set<string>;
  updatingStatusIds: Set<string>;
  updatingProjectFieldIds: Set<string>;
  resyncingIds: Set<string>;
  automaticSyncActive: boolean;
  currentUserIsAdmin: boolean;
  pendingMentionOverrideKey: string | null;
  activeTimezone: string | null;
  activeDateTimeFormat: DateTimeDisplayFormat;
  timezoneTitle: string | undefined;
  jumpDate: string;
  setJumpDate: (value: string) => void;
  jumpToDate: () => void;
  perPageDefault: number;
  perPageChoices: number[];
  changePerPage: (perPage: number) => void;
  changePage: (page: number) => void;
  handleSelectItem: (id: string) => void;
  handleCloseItem: () => void;
  handleItemKeyDown: (event: KeyboardEvent<HTMLDivElement>, id: string) => void;
  handleResyncItem: (item: ActivityItem) => void;
  handleUpdateIssueStatus: (
    item: ActivityItem,
    nextStatus: IssueProjectStatus,
  ) => Promise<void>;
  handleUpdateProjectField: (
    item: ActivityItem,
    field: ProjectFieldKey,
    nextValue: string | null,
  ) => Promise<boolean>;
  handleMentionOverride: (params: {
    itemId: string;
    commentId: string;
    mentionedUserId: string;
    state: "suppress" | "force" | "clear";
  }) => Promise<void>;
  formatDateTimeWithSettings: (
    value: string | null | undefined,
  ) => string | null;
  // IDs for a11y
  jumpDateInputId: string;
  rowsSelectId: string;
};

export function ActivityItemList({
  listData,
  applied,
  userDirectory,
  isLoading,
  openItemId,
  detailMap,
  loadingDetailIds,
  updatingStatusIds,
  updatingProjectFieldIds,
  resyncingIds,
  automaticSyncActive,
  currentUserIsAdmin,
  pendingMentionOverrideKey,
  activeTimezone,
  activeDateTimeFormat,
  timezoneTitle,
  jumpDate,
  setJumpDate,
  jumpToDate,
  perPageDefault,
  perPageChoices,
  changePerPage,
  changePage,
  handleSelectItem,
  handleCloseItem,
  handleItemKeyDown,
  handleResyncItem,
  handleUpdateIssueStatus,
  handleUpdateProjectField,
  handleMentionOverride,
  formatDateTimeWithSettings,
  jumpDateInputId,
  rowsSelectId,
}: ActivityItemListProps) {
  const currentPage = listData.pageInfo.page;
  const visibleItems = listData.items;
  const totalPages = listData.pageInfo.totalPages;
  const totalCount = listData.pageInfo.totalCount;
  const totalPagesDisplay = totalPages;
  const totalCountDisplay = totalCount.toLocaleString();
  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const resyncDisabledMessage =
    "자동 동기화 중이므로 완료 후 실행할 수 있어요.";

  return (
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
            <PickerInput
              id={jumpDateInputId}
              value={jumpDate}
              onChange={(event) => setJumpDate(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && jumpDate) {
                  jumpToDate();
                }
              }}
              className="h-8"
              wrapperClassName="w-[9rem]"
              disabled={isLoading}
              pickerButtonLabel="날짜 이동 달력 열기"
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
          <Label
            className="text-xs font-medium text-foreground"
            htmlFor={rowsSelectId}
          >
            Rows
          </Label>
          <div className="relative">
            <select
              id={rowsSelectId}
              className="h-8 appearance-none rounded-md border border-border bg-background px-2 pr-8 text-sm"
              value={applied.perPage}
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
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
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
                    variant: "relation",
                  });
                }
                if (item.hasSubIssues) {
                  badges.push({
                    key: "parent-issue",
                    label: "Parent 이슈",
                    variant: "relation",
                  });
                }
                const repositoryLabel = item.repository?.nameWithOwner ?? null;
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
                  ? (ISSUE_STATUS_LABEL_MAP.get(item.issueTodoProjectStatus) ??
                    item.issueTodoProjectStatus)
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
                const badgeExtras =
                  item.type === "issue" ? (
                    <>
                      {item.issueType ? (
                        <span className={ISSUE_TYPE_BADGE_CLASS}>
                          {item.issueType.name ?? item.issueType.id}
                        </span>
                      ) : null}
                      {item.milestone ? (
                        <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                          Milestone {item.milestone.title ?? item.milestone.id}
                        </span>
                      ) : null}
                      {todoPriorityLabel !== "-" ? (
                        <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                          {todoPriorityLabel}
                        </span>
                      ) : null}
                      {todoWeightLabel !== "-" ? (
                        <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                          {todoWeightLabel}
                        </span>
                      ) : null}
                    </>
                  ) : null;
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
                    const formatted = formatDateTimeWithSettings(value) ?? "-";
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
                                  <span key={metric.key}>{metric.content}</span>
                                ))}
                                {item.author && (
                                  <span>
                                    작성자 {avatarFallback(item.author) ?? "-"}
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
                                  <span className={ISSUE_TYPE_BADGE_CLASS}>
                                    {item.issueType.name ?? item.issueType.id}
                                  </span>
                                )}
                                {item.milestone && (
                                  <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                                    Milestone{" "}
                                    {item.milestone.title ?? item.milestone.id}
                                  </span>
                                )}
                                {item.type === "issue" &&
                                  displayStatusLabel && (
                                    <span className={PROJECT_FIELD_BADGE_CLASS}>
                                      {displayStatusLabel}
                                    </span>
                                  )}
                                {item.type === "issue" &&
                                  todoPriorityLabel !== "-" && (
                                    <span
                                      className={ISSUE_PRIORITY_BADGE_CLASS}
                                    >
                                      {todoPriorityLabel}
                                    </span>
                                  )}
                                {item.type === "issue" &&
                                  todoWeightLabel !== "-" && (
                                    <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                                      {todoWeightLabel}
                                    </span>
                                  )}
                                {badges.map((badge) => {
                                  const variantClass =
                                    badge.variant === "manual"
                                      ? "border border-slate-300 bg-slate-100 text-slate-700"
                                      : badge.variant === "ai-soft"
                                        ? "border border-sky-300 bg-sky-50 text-sky-700 shadow-[0_0_0.65rem_rgba(56,189,248,0.25)]"
                                        : badge.variant === "answered"
                                          ? "border border-pink-200 bg-pink-100 text-pink-700"
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
                        userDirectory={userDirectory}
                        timezone={activeTimezone}
                        dateTimeFormat={activeDateTimeFormat}
                        onClose={handleCloseItem}
                        onResync={() => handleResyncItem(item)}
                        isResyncing={resyncingIds.has(item.id)}
                        resyncDisabled={automaticSyncActive}
                        resyncDisabledReason={
                          automaticSyncActive ? resyncDisabledMessage : null
                        }
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
                                        variant={active ? "default" : "outline"}
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
                                      Activity 상태는 To-do 프로젝트가 No Status
                                      또는 Todo일 때만 적용돼요.
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
                                        {currentUserIsAdmin && mentionUserId ? (
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
                              commentContext={item.type}
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
                                        if (typeof linked.number === "number") {
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
                                        if (typeof linked.number === "number") {
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
  );
}
