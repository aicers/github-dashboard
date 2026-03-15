"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActivityDetailState } from "@/components/dashboard/hooks/use-activity-detail";
import type { ActivityItem, IssueProjectStatus } from "@/lib/activity/types";
import type {
  IssueAttentionItem,
  MentionAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";
import {
  formatUser,
  type RankingEntry,
  sortRankingByCount,
  sortRankingByTotal,
} from "@/lib/dashboard/attention-summaries";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import { ActivityDetailOverlay } from "../activity/activity-detail-overlay";
import { ActivityListItemSummary } from "../activity/activity-list-item-summary";
import {
  formatProjectField,
  ISSUE_MILESTONE_BADGE_CLASS,
  ISSUE_PRIORITY_BADGE_CLASS,
  ISSUE_STATUS_LABEL_MAP,
  ISSUE_TYPE_BADGE_CLASS,
  ISSUE_WEIGHT_BADGE_CLASS,
  normalizeProjectFieldForComparison,
  PROJECT_FIELD_BADGE_CLASS,
  PROJECT_FIELD_LABELS,
  type ProjectFieldKey,
} from "../activity/detail-shared";
import {
  buildActivityMetricEntries,
  buildAttentionBadges,
  buildLinkedPullRequestSummary,
  formatRelative,
  renderLinkedReferenceInline,
  resolveActivityIcon,
} from "../activity/shared";
import {
  applyAttentionFlagsFromMap,
  buildReferenceLabel,
  createBaseActivityItem,
  formatCount,
  formatDays,
  formatTimestamp,
  formatUserCompact,
  formatUserListCompact,
  renderAttentionBadgeElements,
  toActivityMentionWaits,
  toActivityUsers,
} from "./attention-utils";
import { FollowUpDetailContent } from "./follow-up-detail-content";
import { RankingCard } from "./pr-review-lists";

export function IssueList({
  items,
  emptyText,
  highlightInProgress,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  primaryUserRole = "author",
  showMaintainerControls = false,
  maintainerOptionsOverride,
  repositoryMaintainersByRepository = {},
  mentionWaitMap,
  attentionFlagMap,
  timezone,
  dateTimeFormat,
  segmented = false,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: IssueAttentionItem[];
  emptyText: string;
  highlightInProgress?: boolean;
  metricKey?: "ageDays" | "inProgressAgeDays";
  metricLabel?: string;
  primaryUserRole?: "author" | "repositoryMaintainer";
  showMaintainerControls?: boolean;
  maintainerOptionsOverride?: UserReference[];
  repositoryMaintainersByRepository?: Record<string, UserReference[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [primaryFilter, setPrimaryFilter] = useState("all");
  const [maintainerFilter, setMaintainerFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [updatingProjectFieldIds, setUpdatingProjectFieldIds] = useState<
    Set<string>
  >(() => new Set<string>());
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;
  const primaryLabel =
    primaryUserRole === "repositoryMaintainer" ? "저장소 책임자" : "작성자";
  const resolveItemMaintainers = useCallback(
    (item: IssueAttentionItem) => {
      if (item.repositoryMaintainers?.length) {
        return item.repositoryMaintainers;
      }
      const repoId = item.repository?.id;
      if (repoId) {
        const fallback = repositoryMaintainersByRepository[repoId];
        if (fallback?.length) {
          return fallback;
        }
      }
      return [];
    },
    [repositoryMaintainersByRepository],
  );
  const resolvePrimaryUser = useCallback(
    (item: IssueAttentionItem) =>
      primaryUserRole === "repositoryMaintainer"
        ? (item.repositoryMaintainers ?? [])
        : item.author
          ? [item.author]
          : [],
    [primaryUserRole],
  );

  const aggregation = useMemo(() => {
    const primaryMap = new Map<string, RankingEntry>();
    const maintainerMap = new Map<string, RankingEntry>();
    const assigneeMap = new Map<string, RankingEntry>();

    const getMetric = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);
      const primaryUsers = resolvePrimaryUser(item);

      primaryUsers.forEach((primaryUser) => {
        const entry = primaryMap.get(primaryUser.id) ?? {
          key: primaryUser.id,
          user: primaryUser,
          total: 0,
          count: 0,
        };
        entry.total += metricValue;
        entry.count += 1;
        primaryMap.set(primaryUser.id, entry);
      });

      if (showMaintainerControls) {
        const maintainers = resolveItemMaintainers(item);
        maintainers.forEach((maintainer) => {
          const entry = maintainerMap.get(maintainer.id) ?? {
            key: maintainer.id,
            user: maintainer,
            total: 0,
            count: 0,
          };
          entry.total += metricValue;
          entry.count += 1;
          maintainerMap.set(maintainer.id, entry);
        });
      }

      item.assignees.forEach((assignee) => {
        const assigneeEntry = assigneeMap.get(assignee.id) ?? {
          key: assignee.id,
          user: assignee,
          total: 0,
          count: 0,
        };
        assigneeEntry.total += metricValue;
        assigneeEntry.count += 1;
        assigneeMap.set(assignee.id, assigneeEntry);
      });
    });

    return {
      primary: Array.from(primaryMap.values()),
      maintainers: Array.from(maintainerMap.values()),
      assignees: Array.from(assigneeMap.values()),
    };
  }, [
    items,
    metricKey,
    resolveItemMaintainers,
    resolvePrimaryUser,
    showMaintainerControls,
  ]);

  const primaryOptions = useMemo(() => {
    return aggregation.primary
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.primary]);

  const maintainerOptions = useMemo(() => {
    if (
      Array.isArray(maintainerOptionsOverride) &&
      maintainerOptionsOverride.length
    ) {
      return maintainerOptionsOverride
        .map((user) => ({ key: user.id, label: formatUser(user) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return aggregation.maintainers
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.maintainers, maintainerOptionsOverride]);

  const assigneeOptions = useMemo(() => {
    return aggregation.assignees
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.assignees]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const primaryUsers = resolvePrimaryUser(item);
      const primaryMatch =
        primaryFilter === "all" ||
        primaryUsers.some((primaryUser) => primaryUser.id === primaryFilter);

      const maintainerMatch =
        !showMaintainerControls ||
        maintainerFilter === "all" ||
        resolveItemMaintainers(item).some(
          (maintainer) => maintainer.id === maintainerFilter,
        );

      const assigneeMatch =
        assigneeFilter === "all" ||
        item.assignees.some((assignee) => assignee.id === assigneeFilter);

      return primaryMatch && maintainerMatch && assigneeMatch;
    });
  }, [
    items,
    assigneeFilter,
    maintainerFilter,
    primaryFilter,
    resolveItemMaintainers,
    resolvePrimaryUser,
    showMaintainerControls,
  ]);

  const sortedItems = useMemo(() => {
    const metricFor = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => metricFor(b) - metricFor(a));
  }, [filteredItems, metricKey]);

  const primaryRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.primary);
  }, [aggregation.primary]);

  const primaryRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.primary);
  }, [aggregation.primary]);

  const maintainerRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.maintainers);
  }, [aggregation.maintainers]);

  const maintainerRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.maintainers);
  }, [aggregation.maintainers]);

  const assigneeRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.assignees);
  }, [aggregation.assignees]);

  const assigneeRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.assignees);
  }, [aggregation.assignees]);

  const maintainerFilterEnabled = showMaintainerControls;
  const hasAssigneeFilter = assigneeOptions.length > 0;

  useEffect(() => {
    setPrimaryFilter("all");
  }, []);
  useEffect(() => {
    if (showMaintainerControls) {
      setMaintainerFilter("all");
      return;
    }
    setMaintainerFilter("all");
  }, [showMaintainerControls]);

  const {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem,
    closeItem,
    updateDetailItem,
  } = useActivityDetailState();

  const handleUpdateIssueStatus = useCallback(
    async (activityItem: ActivityItem, nextStatus: IssueProjectStatus) => {
      if (activityItem.type !== "issue") {
        return;
      }

      const currentStatus = activityItem.issueProjectStatus ?? "no_status";
      if (currentStatus === nextStatus && nextStatus !== "no_status") {
        return;
      }

      setUpdatingStatusIds((current) => {
        if (current.has(activityItem.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(activityItem.id);
        return next;
      });

      try {
        const response = await fetch(
          `/api/activity/${encodeURIComponent(activityItem.id)}/status`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              status: nextStatus,
              expectedStatus: currentStatus,
            }),
          },
        );

        let payload:
          | {
              item?: ActivityItem;
              error?: string;
              todoStatus?: IssueProjectStatus;
            }
          | undefined;

        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          payload = undefined;
        }

        if (!response.ok) {
          if (payload?.item) {
            updateDetailItem(payload.item);
          }
          if (payload?.error) {
            console.warn(payload.error);
          }
          return;
        }

        const updatedItem = payload?.item ?? activityItem;
        updateDetailItem(updatedItem);
        const label =
          ISSUE_STATUS_LABEL_MAP.get(
            updatedItem.issueProjectStatus ?? "no_status",
          ) ?? "No Status";
        console.info(`상태를 ${label}로 업데이트했어요.`);
      } catch (error) {
        console.error("Failed to update issue status", error);
      } finally {
        setUpdatingStatusIds((current) => {
          if (!current.has(activityItem.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(activityItem.id);
          return next;
        });
      }
    },
    [updateDetailItem],
  );

  const handleUpdateProjectField = useCallback(
    async (
      activityItem: ActivityItem,
      field: ProjectFieldKey,
      nextValue: string | null,
    ) => {
      if (activityItem.type !== "issue") {
        return false;
      }

      const currentValue = (() => {
        switch (field) {
          case "priority":
            return activityItem.issueTodoProjectPriority;
          case "weight":
            return activityItem.issueTodoProjectWeight;
          case "initiationOptions":
            return activityItem.issueTodoProjectInitiationOptions;
          case "startDate":
            return activityItem.issueTodoProjectStartDate;
          default:
            return null;
        }
      })();
      const currentUpdatedAt = (() => {
        switch (field) {
          case "priority":
            return activityItem.issueTodoProjectPriorityUpdatedAt;
          case "weight":
            return activityItem.issueTodoProjectWeightUpdatedAt;
          case "initiationOptions":
            return activityItem.issueTodoProjectInitiationOptionsUpdatedAt;
          case "startDate":
            return activityItem.issueTodoProjectStartDateUpdatedAt;
          default:
            return null;
        }
      })();

      const normalizedCurrent = normalizeProjectFieldForComparison(
        field,
        currentValue,
      );
      const normalizedNext = normalizeProjectFieldForComparison(
        field,
        nextValue,
      );

      if (normalizedCurrent === normalizedNext) {
        return true;
      }

      setUpdatingProjectFieldIds((current) => {
        if (current.has(activityItem.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(activityItem.id);
        return next;
      });

      try {
        const payload = {
          [field]: nextValue,
          expected: {
            [field]: {
              value: currentValue,
              updatedAt: currentUpdatedAt,
            },
          },
        } as Record<string, unknown>;

        const response = await fetch(
          `/api/activity/${encodeURIComponent(activityItem.id)}/project-fields`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        let payloadResponse:
          | {
              item?: ActivityItem;
              error?: string;
              todoStatus?: IssueProjectStatus;
            }
          | undefined;
        try {
          payloadResponse = (await response.json()) as typeof payloadResponse;
        } catch {
          payloadResponse = undefined;
        }

        if (!response.ok) {
          if (payloadResponse?.item) {
            updateDetailItem(payloadResponse.item);
          }
          if (payloadResponse?.error) {
            console.warn(payloadResponse.error);
          }
          return false;
        }

        const updatedItem = payloadResponse?.item ?? activityItem;
        updateDetailItem(updatedItem);
        const label = PROJECT_FIELD_LABELS[field];
        console.info(`${label} 값을 업데이트했어요.`);
        return true;
      } catch (error) {
        console.error("Failed to update project field", error);
        return false;
      } finally {
        setUpdatingProjectFieldIds((current) => {
          if (!current.has(activityItem.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(activityItem.id);
          return next;
        });
      }
    },
    [updateDetailItem],
  );

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`담당자 ${metricLabel} 합계 순위`}
        entries={assigneeRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="담당자 데이터가 없습니다."
      />
      <RankingCard
        title="담당자 건수 순위"
        entries={assigneeRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="담당자 데이터가 없습니다."
      />
      {showMaintainerControls ? (
        <>
          <RankingCard
            title={`저장소 책임자 ${metricLabel} 합계 순위`}
            entries={maintainerRankingByTotal}
            valueFormatter={(entry) => formatDays(entry.total)}
            emptyText="저장소 책임자 데이터가 없습니다."
          />
          <RankingCard
            title="저장소 책임자 건수 순위"
            entries={maintainerRankingByCount}
            valueFormatter={(entry) => formatCount(entry.count)}
            emptyText="저장소 책임자 데이터가 없습니다."
          />
        </>
      ) : null}
      <RankingCard
        title={`${primaryLabel} ${metricLabel} 합계 순위`}
        entries={primaryRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText={`${primaryLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${primaryLabel} 건수 순위`}
        entries={primaryRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText={`${primaryLabel} 데이터가 없습니다.`}
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      {hasAssigneeFilter ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          담당자 필터
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="all">미적용</option>
            {assigneeOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {maintainerFilterEnabled ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground min-w-[220px]">
          저장소 책임자 필터
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={maintainerFilter}
            onChange={(event) => setMaintainerFilter(event.target.value)}
          >
            <option value="all">미적용</option>
            {maintainerOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {primaryLabel} 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={primaryFilter}
          onChange={(event) => setPrimaryFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {primaryOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const listContent = sortedItems.length ? (
    <ul className="space-y-4">
      {sortedItems.map((item) => {
        const attentionFlags = highlightInProgress
          ? { stalledIssue: true }
          : { backlogIssue: true };
        const activityItem = createBaseActivityItem({
          id: item.id,
          type: "issue",
          number: item.number,
          title: item.title,
          url: item.url,
          repository: item.repository,
          author: item.author,
          attention: attentionFlags,
        });
        activityItem.issueType = item.issueType ?? null;
        activityItem.milestone = item.milestone ?? null;
        activityItem.assignees = toActivityUsers(item.assignees);
        activityItem.linkedPullRequests = item.linkedPullRequests ?? [];
        activityItem.labels = item.labels ?? [];
        activityItem.businessDaysOpen = item.ageDays ?? null;
        activityItem.businessDaysIdle = item.inactivityDays ?? null;
        if (item.inProgressAgeDays !== undefined) {
          activityItem.businessDaysSinceInProgress =
            item.inProgressAgeDays ?? null;
          activityItem.businessDaysInProgressOpen =
            item.inProgressAgeDays ?? null;
        }
        if (item.issueTodoProjectStatus) {
          activityItem.issueTodoProjectStatus = item.issueTodoProjectStatus;
          activityItem.issueProjectStatus =
            item.issueProjectStatus ?? item.issueTodoProjectStatus;
          activityItem.issueProjectStatusSource =
            item.issueProjectStatusSource ?? "todo_project";
          activityItem.issueProjectStatusLocked =
            item.issueProjectStatusLocked ??
            (item.issueTodoProjectStatus === "in_progress" ||
              item.issueTodoProjectStatus === "done" ||
              item.issueTodoProjectStatus === "pending");
        } else {
          activityItem.issueProjectStatus = item.issueProjectStatus ?? null;
          activityItem.issueProjectStatusSource =
            item.issueProjectStatusSource ?? "none";
          activityItem.issueProjectStatusLocked =
            item.issueProjectStatusLocked ?? false;
        }
        activityItem.issueTodoProjectPriority =
          item.issueTodoProjectPriority ?? null;
        activityItem.issueTodoProjectWeight =
          item.issueTodoProjectWeight ?? null;
        activityItem.issueTodoProjectInitiationOptions =
          item.issueTodoProjectInitiationOptions ?? null;
        activityItem.issueTodoProjectStartDate =
          item.issueTodoProjectStartDate ?? null;
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }
        applyAttentionFlagsFromMap(attentionFlagMap, activityItem, item.id);

        const detail = detailMap[item.id] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const displayItem = overlayItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = buildAttentionBadges(displayItem, {
          useMentionAi: true,
        });
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone, dateTimeFormat)
          : "-";
        const linkedPullRequestsInline =
          displayItem.linkedPullRequests.length > 0
            ? renderLinkedReferenceInline({
                label: "연결된 PR",
                type: "pull_request",
                entries: displayItem.linkedPullRequests.map((pr) =>
                  buildLinkedPullRequestSummary(pr),
                ),
                maxItems: 2,
              })
            : null;
        const displayStatusValue =
          displayItem.issueProjectStatus ?? "no_status";
        const displayStatusLabel =
          displayStatusValue !== "no_status"
            ? (ISSUE_STATUS_LABEL_MAP.get(displayStatusValue) ??
              displayStatusValue)
            : null;
        const todoPriorityLabel = formatProjectField(
          displayItem.issueTodoProjectPriority,
        );
        const issueWeightLabel = formatProjectField(
          displayItem.issueTodoProjectWeight,
        );
        const referenceLine = linkedPullRequestsInline ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {linkedPullRequestsInline}
          </div>
        ) : null;
        const overlayBadgeExtras =
          displayItem.type === "issue" ? (
            <>
              {displayItem.issueType ? (
                <span className={ISSUE_TYPE_BADGE_CLASS}>
                  {displayItem.issueType.name ?? displayItem.issueType.id}
                </span>
              ) : null}
              {displayItem.milestone ? (
                <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                  Milestone{" "}
                  {displayItem.milestone.title ?? displayItem.milestone.id}
                </span>
              ) : null}
              {todoPriorityLabel !== "-" ? (
                <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                  {todoPriorityLabel}
                </span>
              ) : null}
              {issueWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {issueWeightLabel}
                </span>
              ) : null}
            </>
          ) : null;
        const metadata = (
          <div className="flex flex-col gap-1 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.author && (
                <span>작성자 {formatUserCompact(item.author)}</span>
              )}
              {item.assignees.length > 0 && (
                <span>담당자 {formatUserListCompact(item.assignees)}</span>
              )}
              {displayItem.issueType ? (
                <span className={ISSUE_TYPE_BADGE_CLASS}>
                  {displayItem.issueType.name ?? displayItem.issueType.id}
                </span>
              ) : null}
              {displayItem.milestone ? (
                <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                  Milestone{" "}
                  {displayItem.milestone.title ?? displayItem.milestone.id}
                </span>
              ) : null}
              {displayItem.type === "issue" && displayStatusLabel ? (
                <span className={PROJECT_FIELD_BADGE_CLASS}>
                  {displayStatusLabel}
                </span>
              ) : null}
              {displayItem.type === "issue" && todoPriorityLabel !== "-" ? (
                <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                  {todoPriorityLabel}
                </span>
              ) : null}
              {displayItem.type === "issue" && issueWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {issueWeightLabel}
                </span>
              ) : null}
              {renderAttentionBadgeElements(badges, item.id)}
              {(displayItem.labels ?? []).slice(0, 2).map((label) => (
                <span
                  key={label.key}
                  className="rounded-md bg-muted px-2 py-0.5"
                >
                  {label.name ?? label.key}
                </span>
              ))}
            </div>
            {referenceLine}
          </div>
        );

        return (
          <li key={item.id}>
            <div
              className={cn(
                "group rounded-md border bg-background p-3 transition focus-within:border-primary/60 focus-within:shadow-md focus-within:shadow-primary/10",
                isSelected
                  ? "border-primary/60 shadow-md shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-muted/20 hover:shadow-md hover:shadow-primary/10",
              )}
            >
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected
                    ? "text-primary"
                    : "text-foreground group-hover:text-primary",
                )}
                onClick={() => selectItem(item.id)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.url ?? undefined}
                    title={item.title}
                    metadata={metadata}
                  />
                  {item.updatedAt ? (
                    <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                      {updatedRelativeLabel ? (
                        <span className="font-medium text-foreground">
                          {updatedRelativeLabel}
                        </span>
                      ) : null}
                      <span title={timezoneTitle}>{updatedAbsoluteLabel}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={overlayItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  badgeExtras={overlayBadgeExtras}
                  timezone={timezone}
                  dateTimeFormat={dateTimeFormat}
                  onClose={closeItem}
                  onResync={
                    typeof onResyncItem === "function"
                      ? () => onResyncItem(overlayItem.id)
                      : undefined
                  }
                  isResyncing={resyncingIds?.has(overlayItem.id) ?? false}
                  resyncDisabled={resyncDisabled}
                  resyncDisabledReason={
                    resyncDisabled ? resyncDisabledReason : null
                  }
                >
                  <FollowUpDetailContent
                    item={overlayItem}
                    detail={detail}
                    isLoading={isDetailLoading}
                    timezone={timezone}
                    dateTimeFormat={dateTimeFormat}
                    isUpdatingStatus={updatingStatusIds.has(item.id)}
                    isUpdatingProjectFields={updatingProjectFieldIds.has(
                      item.id,
                    )}
                    onUpdateStatus={handleUpdateIssueStatus}
                    onUpdateProjectField={handleUpdateProjectField}
                  />
                </ActivityDetailOverlay>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyText}</p>
  );

  if (segmented) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {rankingGrid}
        </section>
        <section className="space-y-4 rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {filterControls}
          {listContent}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {rankingGrid}
        {filterControls}
      </div>
      {listContent}
    </div>
  );
}
