"use client";

import { useMemo, useState } from "react";
import { useActivityDetailState } from "@/components/dashboard/hooks/use-activity-detail";
import type { ActivityItem, IssueProjectStatus } from "@/lib/activity/types";
import type { MentionAttentionItem } from "@/lib/dashboard/attention";
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
  PROJECT_FIELD_BADGE_CLASS,
} from "../activity/detail-shared";
import {
  buildActivityMetricEntries,
  buildAttentionBadges,
  formatRelative,
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
  renderAttentionBadgeElements,
  toActivityMentionWaits,
} from "./attention-utils";
import { FollowUpDetailContent } from "./follow-up-detail-content";
import { RankingCard } from "./pr-review-lists";

export function MentionList({
  items,
  emptyText,
  timezone,
  dateTimeFormat,
  segmented = false,
  isAdmin,
  pendingOverrideKey,
  setPendingOverrideKey,
  onOverrideSuccess,
  mentionWaitMap,
  attentionFlagMap,
  issueProjectInfoMap,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: MentionAttentionItem[];
  emptyText: string;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  isAdmin: boolean;
  pendingOverrideKey: string | null;
  setPendingOverrideKey: (key: string | null) => void;
  onOverrideSuccess: (params: {
    commentId: string;
    mentionedUserId: string;
    suppress: boolean;
    classification: {
      manualRequiresResponse: boolean | null;
      manualRequiresResponseAt: string | null;
      manualDecisionIsStale: boolean;
      requiresResponse: boolean | null;
      lastEvaluatedAt: string | null;
    };
  }) => void;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  issueProjectInfoMap: Map<
    string,
    {
      issueProjectStatus: IssueProjectStatus | null;
      issueProjectStatusSource: ActivityItem["issueProjectStatusSource"];
      issueProjectStatusLocked: boolean;
      issueTodoProjectStatus: IssueProjectStatus | null;
      issueTodoProjectPriority: string | null;
      issueTodoProjectWeight: string | null;
      issueTodoProjectInitiationOptions: string | null;
      issueTodoProjectStartDate: string | null;
    }
  >;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [targetFilter, setTargetFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  type AggregatedMention = {
    selectionId: string;
    representative: MentionAttentionItem;
    mentions: MentionAttentionItem[];
  };

  const aggregatedItems = useMemo<AggregatedMention[]>(() => {
    const map = new Map<
      string,
      { representative: MentionAttentionItem; mentions: MentionAttentionItem[] }
    >();
    items.forEach((mention) => {
      const containerId = mention.container.id ?? null;
      const key =
        containerId && containerId.length > 0 ? containerId : mention.commentId;
      if (!key) {
        return;
      }
      const entry = map.get(key);
      if (entry) {
        entry.mentions.push(mention);
        if (mention.waitingDays > entry.representative.waitingDays) {
          entry.representative = mention;
        }
      } else {
        map.set(key, { representative: mention, mentions: [mention] });
      }
    });

    return Array.from(map.entries()).map(([selectionId, value]) => ({
      selectionId,
      representative: value.representative,
      mentions: value.mentions,
    }));
  }, [items]);

  const aggregation = useMemo(() => {
    const targetMap = new Map<string, RankingEntry>();
    const authorMap = new Map<string, RankingEntry>();

    aggregatedItems.forEach(({ representative }) => {
      const metricValue = representative.waitingDays;
      const target = representative.target;
      const author = representative.author;

      if (target) {
        const targetEntry = targetMap.get(target.id) ?? {
          key: target.id,
          user: target,
          total: 0,
          count: 0,
        };
        targetEntry.total += metricValue;
        targetEntry.count += 1;
        targetMap.set(target.id, targetEntry);
      }

      if (author) {
        const authorEntry = authorMap.get(author.id) ?? {
          key: author.id,
          user: author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(author.id, authorEntry);
      }
    });

    return {
      targets: Array.from(targetMap.values()),
      authors: Array.from(authorMap.values()),
    };
  }, [aggregatedItems]);

  const targetOptions = useMemo(() => {
    return aggregation.targets
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.targets]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const filteredItems = useMemo(() => {
    return aggregatedItems.filter(({ representative }) => {
      const targetMatch =
        targetFilter === "all" || representative.target?.id === targetFilter;

      const authorMatch =
        authorFilter === "all" || representative.author?.id === authorFilter;

      return targetMatch && authorMatch;
    });
  }, [aggregatedItems, targetFilter, authorFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems
      .slice()
      .sort(
        (a, b) => b.representative.waitingDays - a.representative.waitingDays,
      );
  }, [filteredItems]);

  const targetRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.targets);
  }, [aggregation.targets]);

  const targetRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.targets);
  }, [aggregation.targets]);

  const authorRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.authors);
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.authors);
  }, [aggregation.authors]);

  const metricLabel = "경과일수";

  const {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem,
    closeItem,
    updateDetailItem,
  } = useActivityDetailState();

  if (!aggregatedItems.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`멘션 대상 ${metricLabel} 합계 순위`}
        entries={targetRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="멘션 대상 데이터가 없습니다."
      />
      <RankingCard
        title="멘션 대상 건수 순위"
        entries={targetRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="멘션 대상 데이터가 없습니다."
      />
      <RankingCard
        title={`요청자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="요청자 데이터가 없습니다."
      />
      <RankingCard
        title="요청자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="요청자 데이터가 없습니다."
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        멘션 대상 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={targetFilter}
          onChange={(event) => setTargetFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {targetOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        요청자 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={authorFilter}
          onChange={(event) => setAuthorFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {authorOptions.map((option) => (
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
      {sortedItems.map(({ selectionId, representative: item, mentions }) => {
        const containerId = item.container.id ?? null;
        const activityType: ActivityItem["type"] =
          item.container.type === "pull_request"
            ? "pull_request"
            : item.container.type === "discussion"
              ? "discussion"
              : "issue";
        const activityItem = createBaseActivityItem({
          id: selectionId,
          type: activityType,
          number: item.container.number ?? null,
          title: item.container.title,
          url: item.container.url,
          repository: item.container.repository,
          author: item.author,
          attention: { unansweredMention: true },
        });
        if (activityType === "issue") {
          const projectKey =
            containerId && containerId.length > 0 ? containerId : selectionId;
          const fallbackProjectInfo =
            item.issueProjectStatus !== undefined ||
            item.issueProjectStatusSource !== undefined ||
            item.issueProjectStatusLocked !== undefined ||
            item.issueTodoProjectStatus !== undefined ||
            item.issueTodoProjectPriority !== undefined ||
            item.issueTodoProjectWeight !== undefined ||
            item.issueTodoProjectInitiationOptions !== undefined ||
            item.issueTodoProjectStartDate !== undefined
              ? {
                  issueProjectStatus: item.issueProjectStatus ?? null,
                  issueProjectStatusSource:
                    item.issueProjectStatusSource ?? "none",
                  issueProjectStatusLocked:
                    item.issueProjectStatusLocked ?? false,
                  issueTodoProjectStatus: item.issueTodoProjectStatus ?? null,
                  issueTodoProjectPriority:
                    item.issueTodoProjectPriority ?? null,
                  issueTodoProjectWeight: item.issueTodoProjectWeight ?? null,
                  issueTodoProjectInitiationOptions:
                    item.issueTodoProjectInitiationOptions ?? null,
                  issueTodoProjectStartDate:
                    item.issueTodoProjectStartDate ?? null,
                }
              : null;
          const projectInfo =
            issueProjectInfoMap.get(projectKey) ?? fallbackProjectInfo;
          if (projectInfo) {
            activityItem.issueProjectStatus = projectInfo.issueProjectStatus;
            activityItem.issueProjectStatusSource =
              projectInfo.issueProjectStatusSource ?? "none";
            activityItem.issueProjectStatusLocked =
              projectInfo.issueProjectStatusLocked;
            activityItem.issueTodoProjectStatus =
              projectInfo.issueTodoProjectStatus;
            activityItem.issueTodoProjectPriority =
              projectInfo.issueTodoProjectPriority;
            activityItem.issueTodoProjectWeight =
              projectInfo.issueTodoProjectWeight;
            activityItem.issueTodoProjectInitiationOptions =
              projectInfo.issueTodoProjectInitiationOptions;
            activityItem.issueTodoProjectStartDate =
              projectInfo.issueTodoProjectStartDate;
          }
        }
        activityItem.businessDaysOpen = item.waitingDays ?? null;
        activityItem.businessDaysIdle = item.waitingDays ?? null;
        const mentionDetails =
          (containerId && containerId.length > 0
            ? mentionWaitMap.get(containerId)
            : undefined) ?? mentions;
        activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        applyAttentionFlagsFromMap(
          attentionFlagMap,
          activityItem,
          containerId ?? null,
          selectionId,
        );

        const detail = detailMap[selectionId] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const displayItem = overlayItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = `${buildReferenceLabel(
          item.container.repository,
          item.container.number ?? null,
        )} 코멘트`;
        const isSelected = openItemId === selectionId;
        const isDetailLoading = loadingDetailIds.has(selectionId);
        const badges = buildAttentionBadges(displayItem, {
          useMentionAi: true,
        });
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.mentionedAt
          ? formatRelative(item.mentionedAt)
          : null;
        const updatedAbsoluteLabel = item.mentionedAt
          ? formatTimestamp(item.mentionedAt, timezone, dateTimeFormat)
          : "-";
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
        const mentionWeightLabel = formatProjectField(
          displayItem.issueTodoProjectWeight,
        );
        const metadata = (
          <div className="flex flex-col gap-2 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.author && (
                <span>요청자 {formatUserCompact(item.author)}</span>
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
              {displayItem.type === "issue" && mentionWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {mentionWeightLabel}
                </span>
              ) : null}
              {renderAttentionBadgeElements(badges, selectionId)}
              {(displayItem.labels ?? []).slice(0, 2).map((label) => (
                <span
                  key={label.key}
                  className="rounded-md bg-muted px-2 py-0.5"
                >
                  {label.name ?? label.key}
                </span>
              ))}
            </div>
            {item.commentExcerpt ? (
              <div className="text-muted-foreground/70">
                "{item.commentExcerpt}"
              </div>
            ) : null}
          </div>
        );
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
              {mentionWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {mentionWeightLabel}
                </span>
              ) : null}
            </>
          ) : null;
        const primaryMention = overlayItem.mentionWaits?.find(
          (wait) => wait.id && (wait.user?.id ?? wait.userId),
        );
        const primaryMentionUserId =
          primaryMention?.user?.id ?? primaryMention?.userId ?? null;
        const mentionSuppressed =
          primaryMention?.manualRequiresResponse === false;

        const handleMentionToggle = async (
          nextState: "suppress" | "force" | "clear",
        ) => {
          if (!primaryMention?.id) {
            return;
          }
          const user = primaryMention.user;
          const userId = user?.id ?? primaryMentionUserId;
          if (!userId) {
            return;
          }
          const key = `${primaryMention.id}::${userId}`;
          setPendingOverrideKey(key);
          try {
            const response = await fetch(
              "/api/attention/unanswered-mentions/manual",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  commentId: primaryMention.id,
                  mentionedUserId: userId,
                  state: nextState,
                }),
              },
            );

            let payload: unknown;
            try {
              payload = await response.json();
            } catch {
              payload = {};
            }

            const result = (payload as {
              success?: boolean;
              result?: {
                manualRequiresResponse: boolean | null;
                manualRequiresResponseAt: string | null;
                manualDecisionIsStale: boolean;
                requiresResponse: boolean | null;
                lastEvaluatedAt: string | null;
              };
              message?: string;
            }) ?? { success: false };

            if (!response.ok || !result.success || !result.result) {
              throw new Error(
                result.message ??
                  "응답 없는 멘션 상태를 업데이트하지 못했습니다.",
              );
            }

            const classification = result.result;
            const manualEffective = classification.manualDecisionIsStale
              ? null
              : classification.manualRequiresResponse;

            const nextOverlayItem: ActivityItem = {
              ...overlayItem,
              attention: {
                ...overlayItem.attention,
                unansweredMention:
                  manualEffective === false
                    ? false
                    : manualEffective === true
                      ? true
                      : (classification.requiresResponse ??
                        overlayItem.attention.unansweredMention),
              },
              mentionWaits:
                overlayItem.mentionWaits?.map((wait) => {
                  const waitUserId = wait.user?.id ?? wait.userId;
                  if (wait.id === primaryMention.id && waitUserId === userId) {
                    return {
                      ...wait,
                      manualRequiresResponse: manualEffective,
                      manualRequiresResponseAt:
                        classification.manualRequiresResponseAt ?? null,
                      manualDecisionIsStale:
                        classification.manualDecisionIsStale ?? false,
                      classifierEvaluatedAt:
                        classification.lastEvaluatedAt ?? null,
                      requiresResponse: classification.requiresResponse ?? null,
                    } satisfies NonNullable<
                      ActivityItem["mentionWaits"]
                    >[number];
                  }
                  return wait;
                }) ?? undefined,
            } satisfies ActivityItem;

            updateDetailItem(nextOverlayItem);

            onOverrideSuccess({
              commentId: primaryMention.id,
              mentionedUserId: userId,
              suppress: nextState === "suppress",
              classification: {
                manualRequiresResponse: manualEffective,
                manualRequiresResponseAt:
                  classification.manualRequiresResponseAt ?? null,
                manualDecisionIsStale:
                  classification.manualDecisionIsStale ?? false,
                requiresResponse: classification.requiresResponse ?? null,
                lastEvaluatedAt: classification.lastEvaluatedAt ?? null,
              },
            });

            if (nextState === "suppress" && !mentionSuppressed) {
              closeItem();
            }
          } catch (error) {
            console.error(
              "[unanswered-mentions] Failed to update manual override",
              error,
            );
          } finally {
            setPendingOverrideKey(null);
          }
        };

        return (
          <li key={selectionId}>
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
                onClick={() => selectItem(selectionId)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.url ?? undefined}
                    title={item.container.title}
                    metadata={metadata}
                  />
                  <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                    {updatedRelativeLabel ? (
                      <span className="font-medium text-foreground">
                        {updatedRelativeLabel}
                      </span>
                    ) : null}
                    <span title={timezoneTitle}>{updatedAbsoluteLabel}</span>
                  </div>
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
                    isUpdatingStatus={false}
                    isUpdatingProjectFields={false}
                    onUpdateStatus={() => {
                      /* no-op for mentions */
                    }}
                    onUpdateProjectField={async () => false}
                    canManageMentions={isAdmin}
                    pendingMentionOverrideKey={pendingOverrideKey}
                    onUpdateMentionOverride={(next) => {
                      if (!next) {
                        return;
                      }
                      void handleMentionToggle(next.state);
                    }}
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
