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

  const reviewerUnassignedPrs = insights.reviewerUnassignedPrs;
  const reviewerUnassignedMetric = (item: PullRequestAttentionItem) =>
    item.waitingDays ?? 0;
  const reviewerUnassignedAuthors = aggregateUsers(
    reviewerUnassignedPrs,
    (item) => (item.author ? [item.author] : []),
    reviewerUnassignedMetric,
  );

  const reviewStalledPrs = insights.reviewStalledPrs;
  const reviewStalledMetric = (item: PullRequestAttentionItem) =>
    item.waitingDays ?? 0;
  const reviewStalledAuthors = aggregateUsers(
    reviewStalledPrs,
    (item) => (item.author ? [item.author] : []),
    reviewStalledMetric,
  );
  const reviewStalledReviewers = aggregateUsers(
    reviewStalledPrs,
    (item) => item.reviewers,
    reviewStalledMetric,
  );

  const mergeDelayedPrs = insights.mergeDelayedPrs;
  const mergeDelayedMetric = (item: PullRequestAttentionItem) =>
    item.waitingDays ?? 0;
  const mergeDelayedAuthors = aggregateUsers(
    mergeDelayedPrs,
    (item) => (item.author ? [item.author] : []),
    mergeDelayedMetric,
  );
  const mergeDelayedReviewers = aggregateUsers(
    mergeDelayedPrs,
    (item) => item.reviewers,
    mergeDelayedMetric,
  );

  const reviewRequestGroups = new Map<string, ReviewRequestAttentionItem[]>();
  insights.stuckReviewRequests.forEach((item) => {
    const pullRequestId = item.pullRequest.id ?? null;
    const key =
      pullRequestId && pullRequestId.length > 0 ? pullRequestId : item.id;
    const existing = reviewRequestGroups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      reviewRequestGroups.set(key, [item]);
    }
  });
  const dedupedReviewRequests = Array.from(reviewRequestGroups.values()).map(
    (group) =>
      group.reduce(
        (current, entry) =>
          entry.waitingDays > current.waitingDays ? entry : current,
        group[0],
      ),
  );
  const reviewMetric = (item: ReviewRequestAttentionItem) => item.waitingDays;
  const reviewAuthors = aggregateUsers(
    dedupedReviewRequests,
    (item) => (item.pullRequest.author ? [item.pullRequest.author] : []),
    reviewMetric,
  );
  const reviewReviewers = aggregateUsers(
    dedupedReviewRequests,
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
  const stalledRepositoryMaintainers = aggregateUsers(
    stalledIssues,
    (item) => item.repositoryMaintainers ?? [],
    stalledMetric,
  );
  const stalledAssignees = aggregateUsers(
    stalledIssues,
    (item) => item.assignees,
    stalledMetric,
  );

  const mentionGroups = new Map<string, MentionAttentionItem[]>();
  insights.unansweredMentions.forEach((item) => {
    const containerId = item.container.id ?? null;
    const key =
      containerId && containerId.length > 0 ? containerId : item.commentId;
    if (!key) {
      return;
    }
    const existing = mentionGroups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      mentionGroups.set(key, [item]);
    }
  });
  const dedupedMentions = Array.from(mentionGroups.values()).map((group) =>
    group.reduce(
      (current, entry) =>
        entry.waitingDays > current.waitingDays ? entry : current,
      group[0],
    ),
  );
  const mentionMetric = (item: MentionAttentionItem) => item.waitingDays;
  const mentionTargets = aggregateUsers(
    dedupedMentions,
    (item) => (item.target ? [item.target] : []),
    mentionMetric,
  );
  const mentionAuthors = aggregateUsers(
    dedupedMentions,
    (item) => (item.author ? [item.author] : []),
    mentionMetric,
  );

  return [
    {
      id: "reviewer-unassigned-prs",
      title: "리뷰어 미지정 PR",
      description: "2 업무일 이상 리뷰어 미지정 PR",
      count: reviewerUnassignedPrs.length,
      totalMetric: sumMetric(reviewerUnassignedPrs, reviewerUnassignedMetric),
      highlights: [
        highlightLine(
          "최다 작성자",
          findTopByTotal(reviewerUnassignedAuthors, 3),
        ),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "review-stalled-prs",
      title: "리뷰 정체 PR",
      description: "2 업무일 이상 리뷰 정체 PR",
      count: reviewStalledPrs.length,
      totalMetric: sumMetric(reviewStalledPrs, reviewStalledMetric),
      highlights: [
        highlightLine("최다 작성자", findTopByTotal(reviewStalledAuthors, 3)),
        highlightLine("최다 리뷰어", findTopByTotal(reviewStalledReviewers, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "merge-delayed-prs",
      title: "머지 지연 PR",
      description: "2 업무일 이상 머지 지연 PR",
      count: mergeDelayedPrs.length,
      totalMetric: sumMetric(mergeDelayedPrs, mergeDelayedMetric),
      highlights: [
        highlightLine("최다 작성자", findTopByTotal(mergeDelayedAuthors, 3)),
        highlightLine("최다 리뷰어", findTopByTotal(mergeDelayedReviewers, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "stuck-review-requests",
      title: "응답 없는 리뷰 요청",
      description: "5일 이상 응답이 없는 리뷰 요청",
      count: dedupedReviewRequests.length,
      totalMetric: sumMetric(dedupedReviewRequests, reviewMetric),
      highlights: [
        highlightLine("최다 작성자", findTopByTotal(reviewAuthors, 3)),
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
        highlightLine("최다 작성자", findTopByTotal(backlogAuthors, 3)),
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
        highlightLine(
          "최다 저장소 책임자",
          findTopByTotal(stalledRepositoryMaintainers, 3),
        ),
        highlightLine("최다 담당자", findTopByTotal(stalledAssignees, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
    {
      id: "unanswered-mentions",
      title: "응답 없는 멘션",
      description: "5일 이상 응답 없는 멘션",
      count: dedupedMentions.length,
      totalMetric: sumMetric(dedupedMentions, mentionMetric),
      highlights: [
        highlightLine("최다 멘션 대상", findTopByTotal(mentionTargets, 3)),
        highlightLine("최다 요청자", findTopByTotal(mentionAuthors, 3)),
      ].filter((line): line is string => Boolean(line)),
    },
  ];
}
