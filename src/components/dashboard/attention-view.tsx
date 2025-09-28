"use client";

import { type ReactNode, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground";

type RankingEntry = {
  key: string;
  user: UserReference | null;
  total: number;
  count: number;
};

function formatUser(user: UserReference | null) {
  if (!user) {
    return "알 수 없음";
  }

  if (user.name && user.login && user.name !== user.login) {
    return `${user.name} (@${user.login})`;
  }

  return user.name ?? (user.login ? `@${user.login}` : user.id);
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

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
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

    items.forEach((item) => {
      const metricValue =
        metricKey === "inactivityDays"
          ? (item.inactivityDays ?? 0)
          : item.ageDays;

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

  const authorRankingByTotal = useMemo(() => {
    return aggregation.authors.slice().sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return aggregation.authors.slice().sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.authors]);

  const reviewerRankingByTotal = useMemo(() => {
    return aggregation.reviewers.slice().sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.reviewers]);

  const reviewerRankingByCount = useMemo(() => {
    return aggregation.reviewers.slice().sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.reviewers]);

  const hasReviewerFilter = reviewerOptions.length > 0;

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            작성자 필터
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
      </div>

      {filteredItems.length ? (
        <ul className="space-y-4">
          {filteredItems.map((item) => (
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
                    <p className="text-sm text-muted-foreground">
                      {item.title}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>작성자 {formatUser(item.author)}</span>
                    <span>리뷰어 {formatUserList(item.reviewers)}</span>
                    <span className={chipClass}>
                      {formatDays(item.ageDays)} 경과
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

  const authorRankingByTotal = useMemo(() => {
    return aggregation.authors.slice().sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return aggregation.authors.slice().sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.authors]);

  const reviewerRankingByTotal = useMemo(() => {
    return aggregation.reviewers.slice().sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.reviewers]);

  const reviewerRankingByCount = useMemo(() => {
    return aggregation.reviewers.slice().sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return formatUser(a.user).localeCompare(formatUser(b.user));
    });
  }, [aggregation.reviewers]);

  const hasReviewerFilter = reviewerOptions.length > 0;
  const metricLabel = "대기일수";

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            작성자 필터
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
      </div>

      {filteredItems.length ? (
        <ul className="space-y-4">
          {filteredItems.map((item) => (
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
                    <p className="text-sm text-muted-foreground">
                      {item.pullRequest.title}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>작성자 {formatUser(item.pullRequest.author)}</span>
                    <span>대기 중 리뷰어 {formatUser(item.reviewer)}</span>
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
}: {
  items: IssueAttentionItem[];
  emptyText: string;
  highlightInProgress?: boolean;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
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
                <p className="text-sm text-muted-foreground">{item.title}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>작성자 {formatUser(item.author)}</span>
                <span>담당자 {formatUserList(item.assignees)}</span>
                <span className={chipClass}>
                  {formatDays(item.ageDays)} 경과
                </span>
                {highlightInProgress && item.inProgressAgeDays !== undefined ? (
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
  );
}

function MentionList({
  items,
  emptyText,
}: {
  items: MentionAttentionItem[];
  emptyText: string;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => {
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
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>멘션 대상 {formatUser(item.target)}</span>
                  <span>작성자 {formatUser(item.author)}</span>
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
  const generatedAtLabel = formatTimestamp(insights.generatedAt);

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
      menuDescription: "5일 이상 응답이 없는 리뷰 요청",
      title: "5일 이상 (주말과 공휴일 제외) 응답이 없는 리뷰 요청",
      description:
        "주말과 공휴일을 제외하고 5일 이상 리뷰나 반응이 없었던 요청을 모았습니다.",
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
      menuDescription: "20일 이상 In Progress로 이동하지 않은 이슈",
      title: "20일 이상 (주말과 공휴일 제외) In Progress로 이동하지 않은 이슈",
      description:
        "프로젝트에 추가되었지만 주말과 공휴일을 제외한 20일 이상 진행 상태로 전환되지 않은 이슈입니다.",
      content: (
        <IssueList
          items={insights.backlogIssues}
          emptyText="현재 조건을 만족하는 이슈가 없습니다."
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
        />
      ),
    },
    {
      id: "unanswered-mentions",
      menuLabel: "응답 없는 멘션",
      menuDescription: "5일 이상 응답 없는 멘션",
      title: "5일 이상 (주말과 공휴일 제외) 응답이 없는 멘션",
      description:
        "주말과 공휴일을 제외하고 5일 넘게 댓글이나 반응이 없었던 멘션을 모았습니다.",
      content: (
        <MentionList
          items={insights.unansweredMentions}
          emptyText="현재 조건을 만족하는 멘션이 없습니다."
        />
      ),
    },
  ];

  const [activeSectionId, setActiveSectionId] = useState(
    () => sections[0]?.id ?? "",
  );
  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0];

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          중요하지만 오래 머물러 있는 작업과 응답이 필요한 항목을 한눈에
          확인하세요.
        </p>
      </header>

      <div className="text-sm text-muted-foreground">
        데이터 생성 시각: {generatedAtLabel}
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav
          className="flex w-full flex-col gap-2 md:w-72"
          aria-label="Follow-ups 하위 메뉴"
        >
          {sections.map((section) => {
            const selected = section.id === activeSection?.id;
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
          {activeSection ? (
            <Card>
              <CardHeader>
                <CardTitle>{activeSection.title}</CardTitle>
                <CardDescription>{activeSection.description}</CardDescription>
              </CardHeader>
              <CardContent>{activeSection.content}</CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  표시할 Follow-up 항목이 없습니다.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
