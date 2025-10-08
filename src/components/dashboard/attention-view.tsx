"use client";

import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState, useTransition } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

const chipClass =
  "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground";

function InfoBadge({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

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

function renderLink(url: string | null, label: string) {
  if (!url) {
    return <span>{label}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
    >
      {label}
    </a>
  );
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
    <div className="rounded-md border border-border/50 p-3">
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
  return (
    <div className="space-y-6">
      <p className="text-sm text-foreground/80">
        각 하위 메뉴의 항목 수와 누적 경과일수를 요약했습니다. 자세한 내역은
        왼쪽 메뉴에서 원하는 항목을 선택해 확인하세요.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {summaries.map((summary) => (
          <div
            key={summary.id}
            className="flex flex-col gap-3 rounded-md border border-border/50 p-4"
            data-testid={`follow-up-summary-${summary.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {summary.title}
                </div>
                <p className="mt-1 text-xs text-foreground/80">
                  {summary.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelect(summary.id)}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                바로 보기
              </button>
            </div>
            <dl className="grid gap-2 text-sm text-foreground">
              <div className="flex items-center justify-between">
                <dt className="text-foreground/70">항목 수</dt>
                <dd className="font-semibold">{formatCount(summary.count)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-foreground/70">누적 경과일수</dt>
                <dd className="font-semibold">
                  {formatDays(summary.totalMetric)}
                </dd>
              </div>
            </dl>
            {summary.highlights.length ? (
              <ul className="space-y-1 text-sm text-foreground">
                {summary.highlights.map((line) => (
                  <li key={`${summary.id}-${line}`}>{line}</li>
                ))}
              </ul>
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
}: {
  items: PullRequestAttentionItem[];
  emptyText: string;
  showUpdated?: boolean;
  metricKey?: "ageDays" | "inactivityDays";
  metricLabel?: string;
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

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
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
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            생성자 필터
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
            >
              <option value="all">전체</option>
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
                <option value="all">전체</option>
                {reviewerOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {sortedItems.length ? (
        <ul className="space-y-4">
          {sortedItems.map((item) => (
            <li key={item.id}>
              <div className="rounded-lg border border-border/50 p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {renderLink(
                      item.url,
                      `${formatRepository(item.repository)} #${item.number.toString()}`,
                    )}
                  </div>
                  {item.title ? (
                    <p className="text-sm text-foreground">{item.title}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <InfoBadge label="생성자" value={formatUser(item.author)} />
                    <InfoBadge
                      label="리뷰어"
                      value={formatUserList(item.reviewers)}
                    />
                    <span className={chipClass}>
                      {showUpdated
                        ? `생성 ${formatDays(item.ageDays)} 경과`
                        : `${formatDays(item.ageDays)} 경과`}
                    </span>
                    {showUpdated && item.inactivityDays !== undefined ? (
                      <span className={chipClass}>
                        마지막 업데이트 {formatDays(item.inactivityDays)} 전
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          선택한 조건에 해당하는 PR이 없습니다.
        </p>
      )}
    </div>
  );
}

function ReviewRequestList({
  items,
  emptyText,
}: {
  items: ReviewRequestAttentionItem[];
  emptyText: string;
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

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
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
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            생성자 필터
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
            >
              <option value="all">전체</option>
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
                <option value="all">전체</option>
                {reviewerOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {sortedItems.length ? (
        <ul className="space-y-4">
          {sortedItems.map((item) => (
            <li key={item.id}>
              <div className="rounded-lg border border-border/50 p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {renderLink(
                      item.pullRequest.url,
                      `${formatRepository(item.pullRequest.repository)} #${item.pullRequest.number.toString()}`,
                    )}
                  </div>
                  {item.pullRequest.title ? (
                    <p className="text-sm text-foreground">
                      {item.pullRequest.title}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <InfoBadge
                      label="생성자"
                      value={formatUser(item.pullRequest.author)}
                    />
                    <InfoBadge
                      label="대기 중 리뷰어"
                      value={formatUser(item.reviewer)}
                    />
                    <span className={chipClass}>
                      {formatDays(item.waitingDays)} 경과
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          선택한 조건에 해당하는 리뷰 요청이 없습니다.
        </p>
      )}
    </div>
  );
}

function IssueList({
  items,
  emptyText,
  highlightInProgress,
  metricKey = "ageDays",
  metricLabel = "경과일수",
}: {
  items: IssueAttentionItem[];
  emptyText: string;
  highlightInProgress?: boolean;
  metricKey?: "ageDays" | "inProgressAgeDays";
  metricLabel?: string;
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

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
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
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            생성자 필터
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
            >
              <option value="all">전체</option>
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
                <option value="all">전체</option>
                {assigneeOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {sortedItems.length ? (
        <ul className="space-y-4">
          {sortedItems.map((item) => (
            <li key={item.id}>
              <div className="rounded-lg border border-border/50 p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {renderLink(
                      item.url,
                      `${formatRepository(item.repository)} #${item.number.toString()}`,
                    )}
                  </div>
                  {item.title ? (
                    <p className="text-sm text-foreground">{item.title}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <InfoBadge label="생성자" value={formatUser(item.author)} />
                    <InfoBadge
                      label="담당자"
                      value={formatUserList(item.assignees)}
                    />
                    <span className={chipClass}>
                      {highlightInProgress
                        ? `생성 ${formatDays(item.ageDays)} 경과`
                        : `${formatDays(item.ageDays)} 경과`}
                    </span>
                    {highlightInProgress &&
                    item.inProgressAgeDays !== undefined ? (
                      <span className={chipClass}>
                        In Progress {formatDays(item.inProgressAgeDays)} 경과
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          선택한 조건에 해당하는 이슈가 없습니다.
        </p>
      )}
    </div>
  );
}

function MentionList({
  items,
  emptyText,
}: {
  items: MentionAttentionItem[];
  emptyText: string;
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

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
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
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            멘션 대상 필터
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={targetFilter}
              onChange={(event) => setTargetFilter(event.target.value)}
            >
              <option value="all">전체</option>
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
              <option value="all">전체</option>
              {authorOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {sortedItems.length ? (
        <ul className="space-y-4">
          {sortedItems.map((item) => {
            const listKey = `${item.commentId}:${item.target?.id ?? "unknown"}`;
            return (
              <li key={listKey}>
                <div className="rounded-lg border border-border/50 p-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderLink(
                        item.url,
                        `${formatRepository(item.container.repository)} #${item.container.number ?? "?"} 코멘트`,
                      )}
                    </div>
                    {item.commentExcerpt ? (
                      <p className="text-sm text-muted-foreground">
                        “{item.commentExcerpt}”
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <InfoBadge
                        label="멘션 대상"
                        value={formatUser(item.target)}
                      />
                      <InfoBadge
                        label="요청자"
                        value={formatUser(item.author)}
                      />
                      <span className={chipClass}>
                        {formatDays(item.waitingDays)} 경과
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          선택한 조건에 해당하는 멘션이 없습니다.
        </p>
      )}
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

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const sections: FollowUpSection[] = [
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
        />
      ),
    },
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

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          오래 머물러 있는 작업과 응답이 필요한 항목을 한눈에 확인하세요.
        </p>
      </header>

      <div className="flex items-center gap-3 text-sm text-foreground">
        <span>통계 생성 시각: {generatedAtLabel}</span>
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

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav
          className="flex w-full flex-col gap-2 md:w-72"
          aria-label="Follow-ups 하위 메뉴"
        >
          <div className="mb-2 flex flex-col gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-primary/80">
              Overview
            </span>
            <button
              type="button"
              onClick={() => setActiveSectionId(null)}
              className={cn(
                "group relative overflow-hidden rounded-lg border-2 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "before:absolute before:-left-6 before:top-0 before:h-full before:w-20 before:-skew-x-12 before:bg-primary/10 before:transition-opacity before:content-['']",
                activeSectionId === null
                  ? "border-primary bg-primary/10 text-primary shadow-sm before:opacity-100"
                  : "border-muted-foreground/40 bg-muted/20 text-foreground hover:border-primary/60 hover:bg-primary/10 before:opacity-50 hover:before:opacity-80",
              )}
              aria-current={activeSectionId === null ? "true" : undefined}
            >
              <div className="relative z-[1]">
                <div className="text-sm font-semibold">Follow-ups 개요</div>
                <p className="mt-2 text-xs text-foreground/80">
                  전체 하위 메뉴의 요약 통계를 한눈에 확인합니다.
                </p>
              </div>
            </button>
          </div>
          {sections.map((section) => {
            const selected = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSectionId(section.id)}
                className={cn(
                  "rounded-md border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-background hover:border-border hover:bg-muted",
                )}
                aria-current={selected ? "true" : undefined}
              >
                <div className="text-sm font-semibold">{section.menuLabel}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {section.menuDescription}
                </p>
              </button>
            );
          })}
        </nav>

        <div className="flex-1">
          <Card>
            {activeSection ? (
              <>
                <CardHeader>
                  <CardTitle>{activeSection.title}</CardTitle>
                  <CardDescription>{activeSection.description}</CardDescription>
                </CardHeader>
                <CardContent>{activeSection.content}</CardContent>
              </>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>Follow-ups 개요</CardTitle>
                  <CardDescription>
                    전체 현황을 확인하거나 자세한 내용을 보려면 왼쪽 메뉴에서
                    항목을 선택하세요.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FollowUpOverview
                    summaries={summaries}
                    onSelect={(id) => setActiveSectionId(id)}
                  />
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}
