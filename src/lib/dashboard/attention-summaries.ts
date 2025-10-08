import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  PullRequestAttentionItem,
  ReviewRequestAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";

export type RankingEntry = {
  key: string;
  user: UserReference | null;
  total: number;
  count: number;
};

function toDisplayIdentifier(user: UserReference | null) {
  if (!user) {
    return "알 수 없음";
  }

  if (user.name && user.login && user.name !== user.login) {
    return `${user.name} (@${user.login})`;
  }

  return user.name ?? (user.login ? `@${user.login}` : user.id);
}

export function formatUser(user: UserReference | null) {
  return toDisplayIdentifier(user);
}

export function formatUserDisplayName(user: UserReference | null) {
  if (!user) {
    return "알 수 없음";
  }

  if (user.name && user.name.trim().length > 0) {
    return user.name;
  }

  if (user.login && user.login.trim().length > 0) {
    return user.login;
  }

  return "알 수 없음";
}

export function aggregateUsers<T>(
  items: T[],
  getUsers: (item: T) => (UserReference | null)[],
  getMetricValue: (item: T) => number,
): RankingEntry[] {
  const map = new Map<string, RankingEntry>();

  items.forEach((item) => {
    const metricValue = getMetricValue(item);
    const safeMetric = Number.isFinite(metricValue) ? metricValue : 0;
    const users = getUsers(item);
    users.forEach((user) => {
      if (!user?.id) {
        return;
      }

      const existing =
        map.get(user.id) ??
        ({
          key: user.id,
          user,
          total: 0,
          count: 0,
        } satisfies RankingEntry);

      existing.total += safeMetric;
      existing.count += 1;
      map.set(user.id, existing);
    });
  });

  return Array.from(map.values());
}

export function sortRankingByTotal(entries: RankingEntry[]) {
  return entries.slice().sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return formatUser(a.user).localeCompare(formatUser(b.user));
  });
}

export function sortRankingByCount(entries: RankingEntry[]) {
  return entries.slice().sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return formatUser(a.user).localeCompare(formatUser(b.user));
  });
}

export function findTopByTotal(entries: RankingEntry[], limit = 1) {
  return sortRankingByTotal(entries).slice(0, limit);
}

function sumMetric<T>(items: T[], getMetric: (item: T) => number) {
  return items.reduce((acc, item) => {
    const value = getMetric(item);
    if (!Number.isFinite(value)) {
      return acc;
    }
    return acc + value;
  }, 0);
}

export type FollowUpSummary = {
  id: string;
  title: string;
  description: string;
  count: number;
  totalMetric: number;
  highlights: string[];
};

export function buildFollowUpSummaries(
  insights: AttentionInsights,
): FollowUpSummary[] {
  const highlightLine = (label: string, topEntries: RankingEntry[]) => {
    if (!topEntries.length) {
      return null;
    }
    const ranked = topEntries
      .map(
        (entry, index) => `${index + 1}위 ${formatUserDisplayName(entry.user)}`,
      )
      .join(", ");
    return `${label}: ${ranked}`;
  };

  const stalePrs = insights.staleOpenPrs;
  const staleMetric = (item: PullRequestAttentionItem) => item.ageDays ?? 0;
  const staleAuthors = aggregateUsers(
    stalePrs,
    (item) => (item.author ? [item.author] : []),
    staleMetric,
  );
  const staleReviewers = aggregateUsers(
    stalePrs,
    (item) => item.reviewers,
    staleMetric,
  );

  const idlePrs = insights.idleOpenPrs;
  const idleMetric = (item: PullRequestAttentionItem) =>
    item.inactivityDays ?? item.ageDays ?? 0;
  const idleAuthors = aggregateUsers(
    idlePrs,
    (item) => (item.author ? [item.author] : []),
    idleMetric,
  );
  const idleReviewers = aggregateUsers(
    idlePrs,
    (item) => item.reviewers,
    idleMetric,
  );

  const reviewRequests = insights.stuckReviewRequests;
  const reviewMetric = (item: ReviewRequestAttentionItem) => item.waitingDays;
  const reviewAuthors = aggregateUsers(
    reviewRequests,
    (item) => (item.pullRequest.author ? [item.pullRequest.author] : []),
    reviewMetric,
  );
  const reviewReviewers = aggregateUsers(
    reviewRequests,
    (item) => (item.reviewer ? [item.reviewer] : []),
    reviewMetric,
  );

  const backlogIssues = insights.backlogIssues;
  const backlogMetric = (item: IssueAttentionItem) => item.ageDays ?? 0;
  const backlogAuthors = aggregateUsers(
    backlogIssues,
    (item) => (item.author ? [item.author] : []),
    backlogMetric,
  );
  const backlogAssignees = aggregateUsers(
    backlogIssues,
    (item) => item.assignees,
    backlogMetric,
  );

  const stalledIssues = insights.stalledInProgressIssues;
  const stalledMetric = (item: IssueAttentionItem) =>
    item.inProgressAgeDays ?? item.ageDays ?? 0;
  const stalledAuthors = aggregateUsers(
    stalledIssues,
    (item) => (item.author ? [item.author] : []),
    stalledMetric,
  );
  const stalledAssignees = aggregateUsers(
    stalledIssues,
    (item) => item.assignees,
    stalledMetric,
  );

  const mentions = insights.unansweredMentions;
  const mentionMetric = (item: MentionAttentionItem) => item.waitingDays;
  const mentionTargets = aggregateUsers(
    mentions,
    (item) => (item.target ? [item.target] : []),
    mentionMetric,
  );
  const mentionAuthors = aggregateUsers(
    mentions,
    (item) => (item.author ? [item.author] : []),
    mentionMetric,
  );

  return [
    {
      id: "stale-open-prs",
      title: "오래된 PR",
      description: "20일 이상 머지되지 않은 PR",
      count: stalePrs.length,
      totalMetric: sumMetric(stalePrs, staleMetric),
      highlights: [
        highlightLine("최다 생성자", findTopByTotal(staleAuthors, 3)),
        highlightLine("최다 리뷰어", findTopByTotal(staleReviewers, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "idle-open-prs",
      title: "업데이트 없는 PR",
      description: "10일 이상 업데이트가 없는 열린 PR",
      count: idlePrs.length,
      totalMetric: sumMetric(idlePrs, idleMetric),
      highlights: [
        highlightLine("최다 생성자", findTopByTotal(idleAuthors, 3)),
        highlightLine("최다 리뷰어", findTopByTotal(idleReviewers, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "stuck-review-requests",
      title: "응답 없는 리뷰 요청",
      description: "5일 이상 응답이 없는 리뷰 요청",
      count: reviewRequests.length,
      totalMetric: sumMetric(reviewRequests, reviewMetric),
      highlights: [
        highlightLine("최다 생성자", findTopByTotal(reviewAuthors, 3)),
        highlightLine("최다 대기 리뷰어", findTopByTotal(reviewReviewers, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "backlog-issues",
      title: "정체된 Backlog 이슈",
      description: "40일 이상 In Progress로 이동하지 않은 이슈",
      count: backlogIssues.length,
      totalMetric: sumMetric(backlogIssues, backlogMetric),
      highlights: [
        highlightLine("최다 생성자", findTopByTotal(backlogAuthors, 3)),
        highlightLine("최다 담당자", findTopByTotal(backlogAssignees, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "stalled-in-progress-issues",
      title: "정체된 In Progress 이슈",
      description: "In Progress에서 20일 이상 머문 이슈",
      count: stalledIssues.length,
      totalMetric: sumMetric(stalledIssues, stalledMetric),
      highlights: [
        highlightLine("최다 생성자", findTopByTotal(stalledAuthors, 3)),
        highlightLine("최다 담당자", findTopByTotal(stalledAssignees, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "unanswered-mentions",
      title: "응답 없는 멘션",
      description: "5일 이상 응답 없는 멘션",
      count: mentions.length,
      totalMetric: sumMetric(mentions, mentionMetric),
      highlights: [
        highlightLine("최다 멘션 대상", findTopByTotal(mentionTargets, 3)),
        highlightLine("최다 요청자", findTopByTotal(mentionAuthors, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
  ];
}
