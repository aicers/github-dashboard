"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useActivityDetailState } from "@/components/dashboard/hooks/use-activity-detail";
import type { ActivityItem } from "@/lib/activity/types";
import type {
  MentionAttentionItem,
  PullRequestAttentionItem,
  ReviewRequestAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";
import {
  type FollowUpSummary,
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
  buildActivityMetricEntries,
  buildAttentionBadges,
  buildLinkedIssueSummary,
  buildLinkedPullRequestSummary,
  formatRelative,
  renderLinkedReferenceInline,
  resolveActivityIcon,
} from "../activity/shared";
import {
  applyAttentionFlagsFromMap,
  buildReferenceLabel,
  createBaseActivityItem,
  FOLLOW_UP_SECTION_ORDER,
  FOLLOW_UP_SECTION_SET,
  formatCount,
  formatDays,
  formatTimestamp,
  formatUserCompact,
  formatUserListCompact,
  renderAttentionBadgeElements,
  toActivityMentionWaits,
  toActivityReviewWaits,
  toActivityUsers,
} from "./attention-utils";
import { FollowUpDetailContent } from "./follow-up-detail-content";

export function RankingCard({
  title,
  entries,
  valueFormatter,
  emptyText,
}: {
  title: string;
  entries: RankingEntry[];
  valueFormatter: (entry: RankingEntry) => string;
  emptyText: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background p-3">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {entries.length ? (
        <ol className="mt-2 space-y-1 text-sm text-muted-foreground">
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              className="flex items-center justify-between gap-3"
            >
              <span>
                <span className="font-medium text-foreground">
                  {index + 1}.
                </span>{" "}
                {formatUser(entry.user)}
              </span>
              <span className="font-medium text-foreground">
                {valueFormatter(entry)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

export function FollowUpOverview({
  summaries,
  onSelect,
}: {
  summaries: FollowUpSummary[];
  onSelect: (id: string) => void;
}) {
  const summaryMap = new Map(summaries.map((summary) => [summary.id, summary]));
  const orderedSummaries = FOLLOW_UP_SECTION_ORDER.map((summaryId) =>
    summaryMap.get(summaryId),
  ).filter((summary): summary is FollowUpSummary => Boolean(summary));
  const remainingSummaries = summaries.filter(
    (summary) => !FOLLOW_UP_SECTION_SET.has(summary.id),
  );
  const visibleSummaries =
    remainingSummaries.length === 0
      ? orderedSummaries
      : [...orderedSummaries, ...remainingSummaries];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {visibleSummaries.map((summary) => (
          <div
            key={summary.id}
            className="bg-white border border-slate-200 rounded-[14px] p-6"
            data-testid={`follow-up-summary-${summary.id}`}
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-foreground mb-1">
                  {summary.title}
                </h3>
                <p className="text-xs text-foreground/75">
                  {summary.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelect(summary.id)}
                className="flex items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-2 shrink-0"
              >
                바로 보기
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/70">항목 수</span>
                <span className="text-2xl font-bold text-foreground">
                  {formatCount(summary.count)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/70">
                  누적 경과일수
                </span>
                <span className="text-2xl font-bold text-foreground">
                  {formatDays(summary.totalMetric)}
                </span>
              </div>
            </div>

            {summary.highlights.length ? (
              <div className="border-t border-slate-200 pt-3 mt-3">
                <div className="space-y-1">
                  {summary.highlights.map((line) => (
                    <p
                      key={`${summary.id}-${line}`}
                      className="text-xs text-foreground/80"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PullRequestList({
  items,
  emptyText,
  showUpdated,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  attentionOverride,
  primaryUserRole = "author",
  secondaryUserRole = "reviewer",
  reviewWaitMap,
  mentionWaitMap,
  attentionFlagMap,
  repositoryMaintainersByRepository = {},
  timezone,
  dateTimeFormat,
  segmented = false,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: PullRequestAttentionItem[];
  emptyText: string;
  showUpdated?: boolean;
  metricKey?: "ageDays" | "inactivityDays" | "waitingDays";
  metricLabel?: string;
  attentionOverride?: Partial<ActivityItem["attention"]>;
  primaryUserRole?: "author" | "reviewer" | "assignee" | "repositoryMaintainer";
  secondaryUserRole?:
    | "author"
    | "reviewer"
    | "assignee"
    | "repositoryMaintainer";
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  repositoryMaintainersByRepository?: Record<string, UserReference[]>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [primaryFilter, setPrimaryFilter] = useState("all");
  const [secondaryFilter, setSecondaryFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  const roleLabelMap: Record<
    NonNullable<typeof primaryUserRole>,
    "작성자" | "리뷰어" | "담당자" | "저장소 책임자"
  > = {
    author: "작성자",
    reviewer: "리뷰어",
    assignee: "담당자",
    repositoryMaintainer: "저장소 책임자",
  };

  const resolveUsersForRole = useCallback(
    (
      item: PullRequestAttentionItem,
      role: NonNullable<typeof primaryUserRole>,
    ) => {
      if (role === "author") {
        return item.author ? [item.author] : [];
      }
      if (role === "reviewer") {
        return item.reviewers ?? [];
      }
      if (role === "assignee") {
        return item.assignees ?? [];
      }
      const repoId = item.repository?.id;
      if (!repoId) {
        return [];
      }
      return repositoryMaintainersByRepository[repoId] ?? [];
    },
    [repositoryMaintainersByRepository],
  );

  const aggregation = useMemo(() => {
    const primaryMap = new Map<string, RankingEntry>();
    const secondaryMap = new Map<string, RankingEntry>();

    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : metricKey === "waitingDays"
          ? (item.waitingDays ?? item.ageDays ?? 0)
          : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);

      resolveUsersForRole(item, primaryUserRole).forEach((user) => {
        const entry = primaryMap.get(user.id) ?? {
          key: user.id,
          user,
          total: 0,
          count: 0,
        };
        entry.total += metricValue;
        entry.count += 1;
        primaryMap.set(user.id, entry);
      });

      resolveUsersForRole(item, secondaryUserRole).forEach((user) => {
        const entry = secondaryMap.get(user.id) ?? {
          key: user.id,
          user,
          total: 0,
          count: 0,
        };
        entry.total += metricValue;
        entry.count += 1;
        secondaryMap.set(user.id, entry);
      });
    });

    return {
      primary: Array.from(primaryMap.values()),
      secondary: Array.from(secondaryMap.values()),
    };
  }, [
    items,
    metricKey,
    primaryUserRole,
    resolveUsersForRole,
    secondaryUserRole,
  ]);

  const primaryOptions = useMemo(() => {
    return aggregation.primary
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.primary]);

  const secondaryOptions = useMemo(() => {
    return aggregation.secondary
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.secondary]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const primaryUsers = resolveUsersForRole(item, primaryUserRole);
      const secondaryUsers = resolveUsersForRole(item, secondaryUserRole);

      const primaryMatch =
        primaryFilter === "all" ||
        primaryUsers.some((user) => user.id === primaryFilter);

      const secondaryMatch =
        secondaryFilter === "all" ||
        secondaryUsers.some((user) => user.id === secondaryFilter);

      return primaryMatch && secondaryMatch;
    });
  }, [
    items,
    primaryFilter,
    primaryUserRole,
    resolveUsersForRole,
    secondaryFilter,
    secondaryUserRole,
  ]);

  const sortedItems = useMemo(() => {
    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : metricKey === "waitingDays"
          ? (item.waitingDays ?? item.ageDays ?? 0)
          : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => getMetric(b) - getMetric(a));
  }, [filteredItems, metricKey]);

  const primaryRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.primary);
  }, [aggregation.primary]);

  const primaryRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.primary);
  }, [aggregation.primary]);

  const secondaryRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.secondary);
  }, [aggregation.secondary]);

  const secondaryRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.secondary);
  }, [aggregation.secondary]);

  const primaryRoleLabel = roleLabelMap[primaryUserRole];
  const secondaryRoleLabel = roleLabelMap[secondaryUserRole];

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`${primaryRoleLabel} ${metricLabel} 합계 순위`}
        entries={primaryRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText={`${primaryRoleLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${primaryRoleLabel} 건수 순위`}
        entries={primaryRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText={`${primaryRoleLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${secondaryRoleLabel} ${metricLabel} 합계 순위`}
        entries={secondaryRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText={`${secondaryRoleLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${secondaryRoleLabel} 건수 순위`}
        entries={secondaryRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText={`${secondaryRoleLabel} 데이터가 없습니다.`}
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {primaryRoleLabel} 필터
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
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {secondaryRoleLabel} 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={secondaryFilter}
          onChange={(event) => setSecondaryFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {secondaryOptions.map((option) => (
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
        const attentionFlags = attentionOverride ?? {};
        const activityItem = createBaseActivityItem({
          id: item.id,
          type: "pull_request",
          number: item.number,
          title: item.title,
          url: item.url,
          repository: item.repository,
          author: item.author,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          attention: attentionFlags,
        });
        activityItem.reviewers = toActivityUsers(item.reviewers);
        activityItem.businessDaysOpen =
          metricKey === "waitingDays"
            ? (item.waitingDays ?? item.ageDays ?? null)
            : (item.ageDays ?? null);
        if (metricKey === "inactivityDays" || showUpdated) {
          activityItem.businessDaysIdle = item.inactivityDays ?? null;
        }
        activityItem.linkedIssues = item.linkedIssues ?? [];
        applyAttentionFlagsFromMap(attentionFlagMap, activityItem, item.id);
        const reviewWaitDetails = reviewWaitMap.get(item.id) ?? [];
        if (reviewWaitDetails.length) {
          activityItem.reviewRequestWaits =
            toActivityReviewWaits(reviewWaitDetails);
        }
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }
        const linkedPullRequestsInline =
          activityItem.linkedPullRequests.length > 0
            ? renderLinkedReferenceInline({
                label: "연결된 PR",
                type: "pull_request",
                entries: activityItem.linkedPullRequests.map((pr) =>
                  buildLinkedPullRequestSummary(pr),
                ),
                maxItems: 2,
              })
            : null;

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
        const linkedIssuesInline =
          activityItem.linkedIssues.length > 0
            ? renderLinkedReferenceInline({
                label: "연결된 이슈",
                type: "issue",
                entries: activityItem.linkedIssues.map((issue) =>
                  buildLinkedIssueSummary(issue),
                ),
                maxItems: 2,
              })
            : null;
        const referenceLine =
          linkedPullRequestsInline || linkedIssuesInline ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {linkedPullRequestsInline}
              {linkedIssuesInline}
            </div>
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
              {item.reviewers.length > 0 && (
                <span>리뷰어 {formatUserListCompact(item.reviewers)}</span>
              )}
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
                      /* no-op for pull requests */
                    }}
                    onUpdateProjectField={async () => false}
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

export function ReviewRequestList({
  items,
  emptyText,
  reviewWaitMap,
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
  items: ReviewRequestAttentionItem[];
  emptyText: string;
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
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
  const [authorFilter, setAuthorFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  type AggregatedReviewRequest = {
    selectionId: string;
    representative: ReviewRequestAttentionItem;
    reviewRequests: ReviewRequestAttentionItem[];
  };

  const aggregatedItems = useMemo<AggregatedReviewRequest[]>(() => {
    const map = new Map<
      string,
      {
        representative: ReviewRequestAttentionItem;
        reviewRequests: ReviewRequestAttentionItem[];
      }
    >();

    items.forEach((item) => {
      const pullRequestId = (item.pullRequest.id ?? "").trim();
      const key = pullRequestId.length ? pullRequestId : item.id;
      const existing = map.get(key);
      if (existing) {
        existing.reviewRequests.push(item);
        if (item.waitingDays > existing.representative.waitingDays) {
          existing.representative = item;
        }
      } else {
        map.set(key, {
          representative: item,
          reviewRequests: [item],
        });
      }
    });

    return Array.from(map.entries()).map(([selectionId, value]) => ({
      selectionId,
      representative: value.representative,
      reviewRequests: value.reviewRequests,
    }));
  }, [items]);

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const reviewerMap = new Map<string, RankingEntry>();

    aggregatedItems.forEach(({ representative, reviewRequests }) => {
      const metricValue = representative.waitingDays;

      const author = representative.pullRequest.author;
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

      reviewRequests.forEach((request) => {
        const reviewer = request.reviewer;
        if (!reviewer) {
          return;
        }
        const reviewerEntry = reviewerMap.get(reviewer.id) ?? {
          key: reviewer.id,
          user: reviewer,
          total: 0,
          count: 0,
        };
        reviewerEntry.total += request.waitingDays;
        reviewerEntry.count += 1;
        reviewerMap.set(reviewer.id, reviewerEntry);
      });
    });

    return {
      authors: Array.from(authorMap.values()),
      reviewers: Array.from(reviewerMap.values()),
    };
  }, [aggregatedItems]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const reviewerOptions = useMemo(() => {
    return aggregation.reviewers
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.reviewers]);

  const filteredItems = useMemo(() => {
    return aggregatedItems.filter(({ representative, reviewRequests }) => {
      const authorMatch =
        authorFilter === "all" ||
        representative.pullRequest.author?.id === authorFilter;

      const reviewerMatch =
        reviewerFilter === "all" ||
        reviewRequests.some(
          (request) => request.reviewer?.id === reviewerFilter,
        );

      return authorMatch && reviewerMatch;
    });
  }, [aggregatedItems, authorFilter, reviewerFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems
      .slice()
      .sort(
        (a, b) => b.representative.waitingDays - a.representative.waitingDays,
      );
  }, [filteredItems]);

  const authorRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.authors);
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.authors);
  }, [aggregation.authors]);

  const reviewerRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.reviewers);
  }, [aggregation.reviewers]);

  const reviewerRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.reviewers);
  }, [aggregation.reviewers]);

  const hasReviewerFilter = reviewerOptions.length > 0;
  const metricLabel = "대기일수";

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`작성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="작성자 데이터가 없습니다."
      />
      <RankingCard
        title="작성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="작성자 데이터가 없습니다."
      />
      <RankingCard
        title={`리뷰어 ${metricLabel} 합계 순위`}
        entries={reviewerRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="리뷰어 데이터가 없습니다."
      />
      <RankingCard
        title="리뷰어 건수 순위"
        entries={reviewerRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="리뷰어 데이터가 없습니다."
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        작성자 필터
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
      {hasReviewerFilter ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          리뷰어 필터
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={reviewerFilter}
            onChange={(event) => setReviewerFilter(event.target.value)}
          >
            <option value="all">미적용</option>
            {reviewerOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );

  const listContent = sortedItems.length ? (
    <ul className="space-y-4">
      {sortedItems.map(
        ({ selectionId, representative: item, reviewRequests }) => {
          const pullRequest = item.pullRequest;
          const pullRequestId = (pullRequest.id ?? "").trim();
          const resolvedSelectionId = pullRequestId.length
            ? pullRequestId
            : selectionId;
          const activityItem = createBaseActivityItem({
            id: resolvedSelectionId,
            type: "pull_request",
            number: pullRequest.number,
            title: pullRequest.title,
            url: pullRequest.url,
            repository: pullRequest.repository,
            author: pullRequest.author,
            attention: { reviewRequestPending: true },
          });
          activityItem.reviewers = toActivityUsers(pullRequest.reviewers);
          activityItem.businessDaysOpen = item.pullRequestAgeDays ?? null;
          activityItem.businessDaysIdle =
            item.pullRequestInactivityDays ?? item.waitingDays ?? null;
          activityItem.linkedIssues = pullRequest.linkedIssues ?? [];
          applyAttentionFlagsFromMap(
            attentionFlagMap,
            activityItem,
            pullRequestId || resolvedSelectionId,
            item.id,
          );
          const reviewWaitDetails =
            (pullRequestId.length
              ? reviewWaitMap.get(pullRequestId)
              : undefined) ?? reviewRequests;
          if (reviewWaitDetails.length) {
            activityItem.reviewRequestWaits =
              toActivityReviewWaits(reviewWaitDetails);
          }
          const mentionDetails =
            (pullRequestId.length
              ? mentionWaitMap.get(pullRequestId)
              : undefined) ?? [];
          if (mentionDetails.length) {
            activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
          }

          const detail = detailMap[resolvedSelectionId] ?? undefined;
          const overlayItem = detail?.item ?? activityItem;
          const displayItem = overlayItem;
          const iconInfo = resolveActivityIcon(overlayItem);
          const referenceLabel = buildReferenceLabel(
            pullRequest.repository,
            pullRequest.number,
          );
          const isSelected = openItemId === resolvedSelectionId;
          const isDetailLoading = loadingDetailIds.has(resolvedSelectionId);
          const badges = buildAttentionBadges(displayItem, {
            useMentionAi: true,
          });
          const metrics = buildActivityMetricEntries(activityItem);
          const linkedIssuesInline =
            activityItem.linkedIssues.length > 0
              ? renderLinkedReferenceInline({
                  label: "연결된 이슈",
                  type: "issue",
                  entries: activityItem.linkedIssues.map((issue) =>
                    buildLinkedIssueSummary(issue),
                  ),
                  maxItems: 2,
                })
              : null;
          const updatedRelativeLabel = item.pullRequestUpdatedAt
            ? formatRelative(item.pullRequestUpdatedAt)
            : null;
          const updatedAbsoluteLabel = item.pullRequestUpdatedAt
            ? formatTimestamp(
                item.pullRequestUpdatedAt,
                timezone,
                dateTimeFormat,
              )
            : "-";
          const referenceLine = linkedIssuesInline ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {linkedIssuesInline}
            </div>
          ) : null;
          const metadata = (
            <div className="flex flex-col gap-1 text-xs text-foreground/90">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {metrics.map((metric) => (
                  <span key={metric.key}>{metric.content}</span>
                ))}
                {pullRequest.author && (
                  <span>작성자 {formatUserCompact(pullRequest.author)}</span>
                )}
                {renderAttentionBadgeElements(badges, resolvedSelectionId)}
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
            <li key={resolvedSelectionId}>
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
                  onClick={() => selectItem(resolvedSelectionId)}
                >
                  <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                    <ActivityListItemSummary
                      iconInfo={iconInfo}
                      referenceLabel={referenceLabel}
                      referenceUrl={pullRequest.url ?? undefined}
                      title={pullRequest.title}
                      metadata={metadata}
                    />
                    {item.pullRequestUpdatedAt ? (
                      <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                        {updatedRelativeLabel ? (
                          <span className="font-medium text-foreground">
                            {updatedRelativeLabel}
                          </span>
                        ) : null}
                        <span title={timezoneTitle}>
                          {updatedAbsoluteLabel}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </button>
                {isSelected ? (
                  <ActivityDetailOverlay
                    item={overlayItem}
                    iconInfo={iconInfo}
                    badges={badges}
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
                        /* no-op for review requests */
                      }}
                      onUpdateProjectField={async () => false}
                    />
                  </ActivityDetailOverlay>
                ) : null}
              </div>
            </li>
          );
        },
      )}
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
