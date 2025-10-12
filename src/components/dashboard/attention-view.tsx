"use client";

import {
  AtSign,
  ChevronRight,
  CircleDot,
  GitPullRequest,
  GitPullRequestDraft,
  LayoutGrid,
  MessageSquare,
  Play,
  RefreshCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchActivityDetail } from "@/lib/activity/client";
import type {
  ActivityItem,
  ActivityItemDetail,
  ActivityRepository,
  ActivityUser,
} from "@/lib/activity/types";
import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  PullRequestAttentionItem,
  RepositoryReference,
  ReviewRequestAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";
import {
  buildFollowUpSummaries,
  type FollowUpSummary,
  formatUser,
  type RankingEntry,
  sortRankingByCount,
  sortRankingByTotal,
} from "@/lib/dashboard/attention-summaries";
import { cn } from "@/lib/utils";
import { ActivityDetailOverlay } from "./activity/activity-detail-overlay";
import { ActivityListItemSummary } from "./activity/activity-list-item-summary";
import {
  buildActivityMetricEntries,
  formatRelative,
  resolveActivityIcon,
} from "./activity/shared";

function formatUserList(users: UserReference[]) {
  if (!users.length) {
    return "없음";
  }

  return users.map((user) => formatUser(user)).join(", ");
}

function formatRepository(repository: RepositoryReference | null) {
  if (!repository) {
    return "알 수 없음";
  }

  return repository.nameWithOwner ?? repository.name ?? repository.id;
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--일";
  }

  return `${value.toLocaleString()}일`;
}

function formatTimestamp(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const formatted = formatter.format(date);
    return `${formatted} (${timeZone})`;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to format timestamp", error);
    }
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${date.getUTCDate()}`.padStart(2, "0");
    const hours = `${date.getUTCHours()}`.padStart(2, "0");
    const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
  }
}

function formatCount(value: number) {
  return `${value.toLocaleString()}건`;
}

const FOLLOW_UP_SECTION_ORDER = [
  "backlog-issues",
  "stalled-in-progress-issues",
  "stale-open-prs",
  "idle-open-prs",
  "stuck-review-requests",
  "unanswered-mentions",
] as const;

const FOLLOW_UP_SECTION_SET = new Set<string>(FOLLOW_UP_SECTION_ORDER);

function toActivityUser(user: UserReference | null): ActivityUser | null {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: null,
  };
}

function toActivityUsers(users: UserReference[]): ActivityUser[] {
  return users
    .map((user) => toActivityUser(user))
    .filter((user): user is ActivityUser => user !== null);
}

function toActivityReviewWaits(
  entries: ReviewRequestAttentionItem[],
): NonNullable<ActivityItem["reviewRequestWaits"]> {
  return entries.map((entry) => ({
    id: entry.id,
    reviewer: toActivityUser(entry.reviewer ?? null),
    requestedAt: entry.requestedAt ?? null,
    businessDaysWaiting: entry.waitingDays ?? null,
  }));
}

function toActivityMentionWaits(
  entries: MentionAttentionItem[],
): NonNullable<ActivityItem["mentionWaits"]> {
  return entries.map((entry) => ({
    id: entry.commentId,
    user: toActivityUser(entry.target ?? null),
    mentionedAt: entry.mentionedAt ?? null,
    businessDaysWaiting: entry.waitingDays ?? null,
  }));
}

function toActivityRepository(
  repository: RepositoryReference | null,
): ActivityRepository | null {
  if (!repository) {
    return null;
  }
  return {
    id: repository.id,
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
  };
}

function buildAttention(
  overrides: Partial<ActivityItem["attention"]>,
): ActivityItem["attention"] {
  return {
    unansweredMention: false,
    reviewRequestPending: false,
    staleOpenPr: false,
    idlePr: false,
    backlogIssue: false,
    stalledIssue: false,
    ...overrides,
  };
}

function createBaseActivityItem({
  id,
  type,
  status = "open",
  number = null,
  title = null,
  url = null,
  repository,
  author,
  createdAt = null,
  updatedAt = null,
  attention = {},
}: {
  id: string;
  type: ActivityItem["type"];
  status?: ActivityItem["status"];
  number?: number | null;
  title?: string | null;
  url?: string | null;
  repository: RepositoryReference | null;
  author: UserReference | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  attention?: Partial<ActivityItem["attention"]>;
}): ActivityItem {
  return {
    id,
    type,
    status,
    number,
    title,
    url,
    state: status,
    issueProjectStatus: null,
    issueProjectStatusSource: "none",
    issueProjectStatusLocked: false,
    issueTodoProjectStatus: null,
    issueTodoProjectStatusAt: null,
    issueTodoProjectPriority: null,
    issueTodoProjectPriorityUpdatedAt: null,
    issueTodoProjectWeight: null,
    issueTodoProjectWeightUpdatedAt: null,
    issueTodoProjectInitiationOptions: null,
    issueTodoProjectInitiationOptionsUpdatedAt: null,
    issueTodoProjectStartDate: null,
    issueTodoProjectStartDateUpdatedAt: null,
    issueActivityStatus: null,
    issueActivityStatusAt: null,
    repository: toActivityRepository(repository),
    author: toActivityUser(author),
    assignees: [],
    reviewers: [],
    mentionedUsers: [],
    commenters: [],
    reactors: [],
    labels: [],
    issueType: null,
    milestone: null,
    hasParentIssue: false,
    hasSubIssues: false,
    createdAt,
    updatedAt,
    closedAt: null,
    mergedAt: null,
    businessDaysOpen: null,
    businessDaysIdle: null,
    businessDaysSinceInProgress: null,
    businessDaysInProgressOpen: null,
    attention: buildAttention(attention),
  };
}

function buildReferenceLabel(
  repository: RepositoryReference | null,
  number: number | null | undefined,
) {
  const repoLabel = formatRepository(repository);
  if (number === null || number === undefined) {
    return repoLabel;
  }
  return `${repoLabel}#${number.toString()}`;
}

function useActivityDetailState() {
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detailMap, setDetailMap] = useState<
    Record<string, ActivityItemDetail | null>
  >({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      controllersRef.current.forEach((controller) => {
        controller.abort();
      });
      controllersRef.current.clear();
    };
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id.trim()) {
      return;
    }

    setLoadingDetailIds((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });

    const existing = controllersRef.current.get(id);
    existing?.abort();

    const controller = new AbortController();
    controllersRef.current.set(id, controller);

    try {
      const detail = await fetchActivityDetail(id, {
        signal: controller.signal,
      });
      setDetailMap((current) => ({
        ...current,
        [id]: detail,
      }));
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error(error);
        setDetailMap((current) => ({
          ...current,
          [id]: null,
        }));
      }
    } finally {
      controllersRef.current.delete(id);
      setLoadingDetailIds((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const selectItem = useCallback(
    (id: string) => {
      setOpenItemId((current) => {
        if (current === id) {
          const controller = controllersRef.current.get(id);
          controller?.abort();
          controllersRef.current.delete(id);
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(id)) {
              return loadings;
            }
            const next = new Set(loadings);
            next.delete(id);
            return next;
          });
          return null;
        }

        if (current) {
          const controller = controllersRef.current.get(current);
          controller?.abort();
          controllersRef.current.delete(current);
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(current)) {
              return loadings;
            }
            const next = new Set(loadings);
            next.delete(current);
            return next;
          });
        }

        if (!detailMap[id] && !loadingDetailIds.has(id)) {
          void loadDetail(id);
        }

        return id;
      });
    },
    [detailMap, loadDetail, loadingDetailIds],
  );

  const closeItem = useCallback(() => {
    setOpenItemId((current) => {
      if (!current) {
        return current;
      }
      const controller = controllersRef.current.get(current);
      controller?.abort();
      controllersRef.current.delete(current);
      setLoadingDetailIds((loadings) => {
        if (!loadings.has(current)) {
          return loadings;
        }
        const next = new Set(loadings);
        next.delete(current);
        return next;
      });
      return null;
    });
  }, []);

  return {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem,
    closeItem,
  };
}

function FollowUpDetailContent({
  detail,
  isLoading,
}: {
  detail: ActivityItemDetail | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground/80">
        내용을 불러오는 중입니다.
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="text-sm text-muted-foreground/80">
        선택한 항목의 내용을 불러오지 못했습니다.
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-sm text-muted-foreground/80">
        내용을 불러오는 중입니다.
      </div>
    );
  }

  const body = detail.body?.trim()?.length
    ? detail.body
    : (detail.bodyHtml?.trim() ?? "");

  return (
    <div className="space-y-6 text-sm">
      <div className="rounded-md border border-border bg-background px-4 py-3">
        {body.length ? (
          <pre className="whitespace-pre-wrap break-words text-foreground/90">
            {body}
          </pre>
        ) : (
          <div className="text-muted-foreground/80">내용이 없습니다.</div>
        )}
      </div>
      {(detail.parentIssues.length > 0 || detail.subIssues.length > 0) && (
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
                    referenceParts.push(linked.repositoryNameWithOwner);
                  }
                  if (typeof linked.number === "number") {
                    referenceParts.push(`#${linked.number}`);
                  }
                  const referenceLabel =
                    referenceParts.length > 0 ? referenceParts.join("") : null;
                  const titleLabel = linked.title ?? linked.state ?? linked.id;
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
                          className="text-primary hover:underline"
                        >
                          {displayLabel ?? linked.id}
                        </a>
                      ) : (
                        <span>{displayLabel ?? linked.id}</span>
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
                    referenceParts.push(linked.repositoryNameWithOwner);
                  }
                  if (typeof linked.number === "number") {
                    referenceParts.push(`#${linked.number}`);
                  }
                  const referenceLabel =
                    referenceParts.length > 0 ? referenceParts.join("") : null;
                  const titleLabel = linked.title ?? linked.state ?? linked.id;
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
                          className="text-primary hover:underline"
                        >
                          {displayLabel ?? linked.id}
                        </a>
                      ) : (
                        <span>{displayLabel ?? linked.id}</span>
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
  );
}

function RankingCard({
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

function FollowUpOverview({
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

function PullRequestList({
  items,
  emptyText,
  showUpdated,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  reviewWaitMap,
  mentionWaitMap,
  timezone,
  segmented = false,
}: {
  items: PullRequestAttentionItem[];
  emptyText: string;
  showUpdated?: boolean;
  metricKey?: "ageDays" | "inactivityDays";
  metricLabel?: string;
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  timezone: string;
  segmented?: boolean;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const reviewerMap = new Map<string, RankingEntry>();

    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);

      if (item.author) {
        const authorKey = item.author.id;
        const authorEntry = authorMap.get(authorKey) ?? {
          key: authorKey,
          user: item.author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(authorKey, authorEntry);
      }

      item.reviewers.forEach((reviewer) => {
        const reviewerEntry = reviewerMap.get(reviewer.id) ?? {
          key: reviewer.id,
          user: reviewer,
          total: 0,
          count: 0,
        };
        reviewerEntry.total += metricValue;
        reviewerEntry.count += 1;
        reviewerMap.set(reviewer.id, reviewerEntry);
      });
    });

    return {
      authors: Array.from(authorMap.values()),
      reviewers: Array.from(reviewerMap.values()),
    };
  }, [items, metricKey]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const reviewerOptions = useMemo(() => {
    return aggregation.reviewers
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.reviewers]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const authorMatch =
        authorFilter === "all" || item.author?.id === authorFilter;

      const reviewerMatch =
        reviewerFilter === "all" ||
        item.reviewers.some((reviewer) => reviewer.id === reviewerFilter);

      return authorMatch && reviewerMatch;
    });
  }, [items, authorFilter, reviewerFilter]);

  const sortedItems = useMemo(() => {
    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => getMetric(b) - getMetric(a));
  }, [filteredItems, metricKey]);

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

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`생성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="생성자 데이터가 없습니다."
      />
      <RankingCard
        title="생성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="생성자 데이터가 없습니다."
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
        생성자 필터
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
      {sortedItems.map((item) => {
        const attentionFlags = showUpdated
          ? { idlePr: true }
          : { staleOpenPr: true };
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
        activityItem.businessDaysOpen = item.ageDays ?? null;
        if (item.inactivityDays !== undefined) {
          activityItem.businessDaysIdle = item.inactivityDays ?? null;
        }
        const reviewWaitDetails = reviewWaitMap.get(item.id) ?? [];
        if (reviewWaitDetails.length) {
          activityItem.reviewRequestWaits =
            toActivityReviewWaits(reviewWaitDetails);
        }
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }

        const iconInfo = resolveActivityIcon(activityItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const detail = detailMap[item.id] ?? undefined;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = [showUpdated ? "업데이트 없는 PR" : "오래된 PR"];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone)
          : "-";
        const metadata = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
            {metrics.map((metric) => (
              <span key={metric.key}>{metric.content}</span>
            ))}
            {item.author && <span>작성자 {formatUser(item.author)}</span>}
            {item.reviewers.length > 0 && (
              <span>리뷰어 {formatUserList(item.reviewers)}</span>
            )}
          </div>
        );

        return (
          <li key={item.id}>
            <div className="rounded-md border border-border bg-background p-3">
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none border-none",
                  isSelected
                    ? "text-foreground"
                    : "text-foreground hover:text-primary",
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
                        <span className="font-medium uppercase text-foreground">
                          {updatedRelativeLabel}
                        </span>
                      ) : null}
                      <span>{updatedAbsoluteLabel}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={activityItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  onClose={closeItem}
                >
                  <FollowUpDetailContent
                    detail={detail}
                    isLoading={isDetailLoading}
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

function ReviewRequestList({
  items,
  emptyText,
  reviewWaitMap,
  mentionWaitMap,
  timezone,
  segmented = false,
}: {
  items: ReviewRequestAttentionItem[];
  emptyText: string;
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  timezone: string;
  segmented?: boolean;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const reviewerMap = new Map<string, RankingEntry>();

    items.forEach((item) => {
      const metricValue = item.waitingDays;

      const author = item.pullRequest.author;
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

      const reviewer = item.reviewer;
      if (reviewer) {
        const reviewerEntry = reviewerMap.get(reviewer.id) ?? {
          key: reviewer.id,
          user: reviewer,
          total: 0,
          count: 0,
        };
        reviewerEntry.total += metricValue;
        reviewerEntry.count += 1;
        reviewerMap.set(reviewer.id, reviewerEntry);
      }
    });

    return {
      authors: Array.from(authorMap.values()),
      reviewers: Array.from(reviewerMap.values()),
    };
  }, [items]);

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
    return items.filter((item) => {
      const authorMatch =
        authorFilter === "all" || item.pullRequest.author?.id === authorFilter;

      const reviewerMatch =
        reviewerFilter === "all" || item.reviewer?.id === reviewerFilter;

      return authorMatch && reviewerMatch;
    });
  }, [items, authorFilter, reviewerFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems.slice().sort((a, b) => b.waitingDays - a.waitingDays);
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
        title={`생성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="생성자 데이터가 없습니다."
      />
      <RankingCard
        title="생성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="생성자 데이터가 없습니다."
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
        생성자 필터
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
      {sortedItems.map((item) => {
        const selectionId = item.pullRequest.id?.trim().length
          ? item.pullRequest.id
          : item.id;
        const activityItem = createBaseActivityItem({
          id: selectionId,
          type: "pull_request",
          number: item.pullRequest.number,
          title: item.pullRequest.title,
          url: item.pullRequest.url,
          repository: item.pullRequest.repository,
          author: item.pullRequest.author,
          attention: { reviewRequestPending: true },
        });
        activityItem.reviewers = toActivityUsers(item.pullRequest.reviewers);
        activityItem.businessDaysOpen = item.pullRequestAgeDays ?? null;
        activityItem.businessDaysIdle =
          item.pullRequestInactivityDays ?? item.waitingDays ?? null;
        const reviewWaitDetails = reviewWaitMap.get(item.pullRequest.id) ?? [];
        if (reviewWaitDetails.length) {
          activityItem.reviewRequestWaits =
            toActivityReviewWaits(reviewWaitDetails);
        } else {
          activityItem.reviewRequestWaits = toActivityReviewWaits([item]);
        }
        const mentionDetails = mentionWaitMap.get(item.pullRequest.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }

        const iconInfo = resolveActivityIcon(activityItem);
        const referenceLabel = buildReferenceLabel(
          item.pullRequest.repository,
          item.pullRequest.number,
        );
        const isSelected = openItemId === selectionId;
        const detail = detailMap[selectionId] ?? undefined;
        const isDetailLoading = loadingDetailIds.has(selectionId);
        const badges = ["응답 없는 리뷰 요청"];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.pullRequestUpdatedAt
          ? formatRelative(item.pullRequestUpdatedAt)
          : null;
        const updatedAbsoluteLabel = item.pullRequestUpdatedAt
          ? formatTimestamp(item.pullRequestUpdatedAt, timezone)
          : "-";
        const metadata = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
            {metrics.map((metric) => (
              <span key={metric.key}>{metric.content}</span>
            ))}
            {item.pullRequest.author && (
              <span>생성자 {formatUser(item.pullRequest.author)}</span>
            )}
          </div>
        );

        return (
          <li key={item.id}>
            <div className="rounded-md border border-border bg-background p-3">
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none border-none",
                  isSelected
                    ? "text-foreground"
                    : "text-foreground hover:text-primary",
                )}
                onClick={() => selectItem(selectionId)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.pullRequest.url ?? undefined}
                    title={item.pullRequest.title}
                    metadata={metadata}
                  />
                  {item.pullRequestUpdatedAt ? (
                    <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                      {updatedRelativeLabel ? (
                        <span className="font-medium uppercase text-foreground">
                          {updatedRelativeLabel}
                        </span>
                      ) : null}
                      <span>{updatedAbsoluteLabel}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={activityItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  onClose={closeItem}
                >
                  <FollowUpDetailContent
                    detail={detail}
                    isLoading={isDetailLoading}
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

function IssueList({
  items,
  emptyText,
  highlightInProgress,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  mentionWaitMap,
  timezone,
  segmented = false,
}: {
  items: IssueAttentionItem[];
  emptyText: string;
  highlightInProgress?: boolean;
  metricKey?: "ageDays" | "inProgressAgeDays";
  metricLabel?: string;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  timezone: string;
  segmented?: boolean;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const assigneeMap = new Map<string, RankingEntry>();

    const getMetric = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);

      if (item.author) {
        const authorEntry = authorMap.get(item.author.id) ?? {
          key: item.author.id,
          user: item.author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(item.author.id, authorEntry);
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
      authors: Array.from(authorMap.values()),
      assignees: Array.from(assigneeMap.values()),
    };
  }, [items, metricKey]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const assigneeOptions = useMemo(() => {
    return aggregation.assignees
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.assignees]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const authorMatch =
        authorFilter === "all" || item.author?.id === authorFilter;

      const assigneeMatch =
        assigneeFilter === "all" ||
        item.assignees.some((assignee) => assignee.id === assigneeFilter);

      return authorMatch && assigneeMatch;
    });
  }, [items, authorFilter, assigneeFilter]);

  const sortedItems = useMemo(() => {
    const metricFor = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => metricFor(b) - metricFor(a));
  }, [filteredItems, metricKey]);

  const authorRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.authors);
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.authors);
  }, [aggregation.authors]);

  const assigneeRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.assignees);
  }, [aggregation.assignees]);

  const assigneeRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.assignees);
  }, [aggregation.assignees]);

  const hasAssigneeFilter = assigneeOptions.length > 0;

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`생성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="생성자 데이터가 없습니다."
      />
      <RankingCard
        title="생성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="생성자 데이터가 없습니다."
      />
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
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        생성자 필터
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
        activityItem.assignees = toActivityUsers(item.assignees);
        activityItem.businessDaysOpen = item.ageDays ?? null;
        if (item.inProgressAgeDays !== undefined) {
          activityItem.businessDaysSinceInProgress =
            item.inProgressAgeDays ?? null;
          activityItem.businessDaysInProgressOpen =
            item.inProgressAgeDays ?? null;
        }
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }

        const iconInfo = resolveActivityIcon(activityItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const detail = detailMap[item.id] ?? undefined;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = [
          highlightInProgress
            ? "정체된 In Progress 이슈"
            : "정체된 Backlog 이슈",
        ];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone)
          : "-";
        const metadata = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
            {metrics.map((metric) => (
              <span key={metric.key}>{metric.content}</span>
            ))}
            {item.author && <span>생성자 {formatUser(item.author)}</span>}
            {item.assignees.length > 0 && (
              <span>담당자 {formatUserList(item.assignees)}</span>
            )}
          </div>
        );

        return (
          <li key={item.id}>
            <div className="rounded-md border border-border bg-background p-3">
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none border-none",
                  isSelected
                    ? "text-foreground"
                    : "text-foreground hover:text-primary",
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
                        <span className="font-medium uppercase text-foreground">
                          {updatedRelativeLabel}
                        </span>
                      ) : null}
                      <span>{updatedAbsoluteLabel}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={activityItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  onClose={closeItem}
                >
                  <FollowUpDetailContent
                    detail={detail}
                    isLoading={isDetailLoading}
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

function MentionList({
  items,
  emptyText,
  timezone,
  segmented = false,
}: {
  items: MentionAttentionItem[];
  emptyText: string;
  timezone: string;
  segmented?: boolean;
}) {
  const [targetFilter, setTargetFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");

  const aggregation = useMemo(() => {
    const targetMap = new Map<string, RankingEntry>();
    const authorMap = new Map<string, RankingEntry>();

    items.forEach((item) => {
      const metricValue = item.waitingDays;

      if (item.target) {
        const targetEntry = targetMap.get(item.target.id) ?? {
          key: item.target.id,
          user: item.target,
          total: 0,
          count: 0,
        };
        targetEntry.total += metricValue;
        targetEntry.count += 1;
        targetMap.set(item.target.id, targetEntry);
      }

      if (item.author) {
        const authorEntry = authorMap.get(item.author.id) ?? {
          key: item.author.id,
          user: item.author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(item.author.id, authorEntry);
      }
    });

    return {
      targets: Array.from(targetMap.values()),
      authors: Array.from(authorMap.values()),
    };
  }, [items]);

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
    return items.filter((item) => {
      const targetMatch =
        targetFilter === "all" || item.target?.id === targetFilter;

      const authorMatch =
        authorFilter === "all" || item.author?.id === authorFilter;

      return targetMatch && authorMatch;
    });
  }, [items, targetFilter, authorFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems.slice().sort((a, b) => b.waitingDays - a.waitingDays);
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

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
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
      {sortedItems.map((item, index) => {
        const containerId = item.container.id?.trim();
        const selectionId =
          containerId && containerId.length > 0 ? containerId : item.commentId;
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
        activityItem.businessDaysOpen = item.waitingDays ?? null;
        activityItem.businessDaysIdle = item.waitingDays ?? null;
        activityItem.mentionWaits = toActivityMentionWaits([item]);

        const iconInfo = resolveActivityIcon(activityItem);
        const referenceLabel = `${buildReferenceLabel(
          item.container.repository,
          item.container.number ?? null,
        )} 코멘트`;
        const isSelected = openItemId === selectionId;
        const detail = detailMap[selectionId] ?? undefined;
        const isDetailLoading = loadingDetailIds.has(selectionId);
        const badges = ["응답 없는 멘션"];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.mentionedAt
          ? formatRelative(item.mentionedAt)
          : null;
        const updatedAbsoluteLabel = item.mentionedAt
          ? formatTimestamp(item.mentionedAt, timezone)
          : "-";
        const metadata = (
          <div className="flex flex-col gap-2 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.target && <span>멘션 대상 {formatUser(item.target)}</span>}
              {item.author && <span>요청자 {formatUser(item.author)}</span>}
            </div>
            {item.commentExcerpt ? (
              <div className="text-muted-foreground/70">
                “{item.commentExcerpt}”
              </div>
            ) : null}
          </div>
        );

        return (
          <li
            key={`${item.commentId}:${item.target?.id ?? "unknown"}:${index}`}
          >
            <div className="rounded-md border border-border bg-background p-3">
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none border-none",
                  isSelected
                    ? "text-foreground"
                    : "text-foreground hover:text-primary",
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
                      <span className="font-medium uppercase text-foreground">
                        {updatedRelativeLabel}
                      </span>
                    ) : null}
                    <span>{updatedAbsoluteLabel}</span>
                  </div>
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={activityItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  onClose={closeItem}
                >
                  <FollowUpDetailContent
                    detail={detail}
                    isLoading={isDetailLoading}
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

type FollowUpSection = {
  id: string;
  menuLabel: string;
  menuDescription: string;
  title: string;
  description: string;
  content: ReactNode;
};

export function AttentionView({ insights }: { insights: AttentionInsights }) {
  const generatedAtLabel = formatTimestamp(
    insights.generatedAt,
    insights.timezone,
  );
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const reviewWaitMap = useMemo(() => {
    const map = new Map<string, ReviewRequestAttentionItem[]>();
    insights.stuckReviewRequests.forEach((item) => {
      const prId = item.pullRequest.id;
      if (!prId) {
        return;
      }
      const existing = map.get(prId) ?? [];
      existing.push(item);
      map.set(prId, existing);
    });
    return map;
  }, [insights.stuckReviewRequests]);

  const mentionWaitMap = useMemo(() => {
    const map = new Map<string, MentionAttentionItem[]>();
    insights.unansweredMentions.forEach((item) => {
      const containerId = item.container.id;
      if (!containerId) {
        return;
      }
      const existing = map.get(containerId) ?? [];
      existing.push(item);
      map.set(containerId, existing);
    });
    return map;
  }, [insights.unansweredMentions]);

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const sections: FollowUpSection[] = [
    {
      id: "backlog-issues",
      menuLabel: "정체된 Backlog 이슈",
      menuDescription: "40일 이상 In Progress로 이동하지 않은 이슈",
      title: "40일 이상 (주말과 공휴일 제외) In Progress로 이동하지 않은 이슈",
      description:
        "프로젝트에 추가되었지만 주말과 공휴일을 제외한 40일 이상 진행 상태로 전환되지 않은 이슈입니다.",
      content: (
        <IssueList
          items={insights.backlogIssues}
          emptyText="현재 조건을 만족하는 이슈가 없습니다."
          metricLabel="경과일수"
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          segmented
        />
      ),
    },
    {
      id: "stalled-in-progress-issues",
      menuLabel: "정체된 In Progress 이슈",
      menuDescription: "In Progress에서 20일 이상 머문 이슈",
      title: "In Progress에서 20일 이상 (주말과 공휴일 제외) 정체된 이슈",
      description:
        "In Progress 상태로 전환된 후 주말과 공휴일을 제외한 20일 이상 종료되지 않은 이슈입니다.",
      content: (
        <IssueList
          items={insights.stalledInProgressIssues}
          emptyText="현재 조건을 만족하는 이슈가 없습니다."
          highlightInProgress
          metricKey="inProgressAgeDays"
          metricLabel="In Progress 경과일수"
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          segmented
        />
      ),
    },
    {
      id: "stale-open-prs",
      menuLabel: "오래된 PR",
      menuDescription: "20일 이상 머지되지 않은 PR",
      title: "20일 이상 (주말과 공휴일 제외) 머지되지 않은 PR",
      description:
        "열린 상태로 주말과 공휴일을 제외한 20일 이상 유지되고 있는 PR 목록입니다.",
      content: (
        <PullRequestList
          items={insights.staleOpenPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          segmented
        />
      ),
    },
    {
      id: "idle-open-prs",
      menuLabel: "업데이트 없는 PR",
      menuDescription: "10일 이상 업데이트가 없는 열린 PR",
      title: "10일 이상 (주말과 공휴일 제외) 업데이트가 없는 열린 PR",
      description:
        "최근 업데이트가 주말과 공휴일을 제외한 10일 이상 없었던 열린 PR을 보여줍니다.",
      content: (
        <PullRequestList
          items={insights.idleOpenPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          showUpdated
          metricKey="inactivityDays"
          metricLabel="미업데이트 경과일수"
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          segmented
        />
      ),
    },
    {
      id: "stuck-review-requests",
      menuLabel: "응답 없는 리뷰 요청",
      menuDescription:
        "5일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 리뷰 요청",
      title: "5일 이상 (주말과 공휴일 제외) 응답이 없는 리뷰 요청",
      description:
        "주말과 공휴일을 제외하고 5일 이상 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 리뷰 요청을 모았습니다.",
      content: (
        <ReviewRequestList
          items={insights.stuckReviewRequests}
          emptyText="현재 조건을 만족하는 리뷰 요청이 없습니다."
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          segmented
        />
      ),
    },
    {
      id: "unanswered-mentions",
      menuLabel: "응답 없는 멘션",
      menuDescription:
        "5일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 멘션",
      title: "5일 이상 (주말과 공휴일 제외) 응답이 없는 멘션",
      description:
        "주말과 공휴일을 제외하고 5일 넘게 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 멘션을 모았습니다.",
      content: (
        <MentionList
          items={insights.unansweredMentions}
          emptyText="현재 조건을 만족하는 멘션이 없습니다."
          timezone={insights.timezone}
          segmented
        />
      ),
    },
  ];

  const summaries = useMemo<FollowUpSummary[]>(() => {
    return buildFollowUpSummaries(insights);
  }, [insights]);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const activeSection = activeSectionId
    ? sections.find((section) => section.id === activeSectionId)
    : undefined;
  const overviewMenuDescription =
    "전체 하위 메뉴의 요약 통계를 한눈에 확인합니다.";
  const activeMenuDescription =
    activeSectionId === null
      ? overviewMenuDescription
      : activeSection?.menuDescription;
  const useFollowUpLayout =
    activeSection && FOLLOW_UP_SECTION_SET.has(activeSection.id);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <p className="text-sm text-muted-foreground">
            정체된 작업이나 요청을 확인하세요.
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
              통계 생성 시각:
              <span className="font-semibold text-foreground/80">
                {generatedAtLabel}
              </span>
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
              )}
              aria-label="Follow-ups 통계 새로 고침"
            >
              <RefreshCcw
                className={cn("h-4 w-4", isRefreshing ? "animate-spin" : "")}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        <nav
          className="border-b border-slate-200"
          aria-label="Follow-ups 하위 메뉴"
        >
          <div className="flex gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveSectionId(null)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                activeSectionId === null
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              aria-current={activeSectionId === null ? "true" : undefined}
            >
              <LayoutGrid className="h-4 w-4" />
              Overview
            </button>
            {sections.map((section) => {
              const selected = section.id === activeSectionId;

              // 각 섹션별 아이콘 매핑
              const getIcon = () => {
                switch (section.id) {
                  case "stale-open-prs":
                    return <GitPullRequest className="h-4 w-4" />;
                  case "idle-open-prs":
                    return <GitPullRequestDraft className="h-4 w-4" />;
                  case "stuck-review-requests":
                    return <MessageSquare className="h-4 w-4" />;
                  case "backlog-issues":
                    return <CircleDot className="h-4 w-4" />;
                  case "stalled-in-progress-issues":
                    return <Play className="h-4 w-4" />;
                  case "unanswered-mentions":
                    return <AtSign className="h-4 w-4" />;
                  default:
                    return <CircleDot className="h-4 w-4" />;
                }
              };

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium transition border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    selected
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={selected ? "true" : undefined}
                >
                  {getIcon()}
                  {section.menuLabel}
                </button>
              );
            })}
          </div>
          {activeMenuDescription ? (
            <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30">
              {activeMenuDescription}
            </div>
          ) : null}
        </nav>

        <div className="flex-1">
          {activeSection ? (
            useFollowUpLayout ? (
              activeSection.content
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>{activeSection.title}</CardTitle>
                  <CardDescription>{activeSection.description}</CardDescription>
                </CardHeader>
                <CardContent>{activeSection.content}</CardContent>
              </Card>
            )
          ) : (
            <FollowUpOverview
              summaries={summaries}
              onSelect={(id) => setActiveSectionId(id)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
