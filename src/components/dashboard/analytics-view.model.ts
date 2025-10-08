import { type ReactNode, useMemo, useState } from "react";

import { toCardHistory } from "@/components/dashboard/metric-history";
import { roundToOneDecimal } from "@/lib/dashboard/analytics/shared";
import {
  formatDuration,
  formatNumber,
} from "@/lib/dashboard/metric-formatters";
import {
  buildDateKeys,
  buildNetTrend,
  mergeTrends,
} from "@/lib/dashboard/trend-utils";
import type {
  ComparisonValue,
  DashboardAnalytics,
  LeaderboardEntry,
  OrganizationAnalytics,
  RepoComparisonRow,
} from "@/lib/dashboard/types";

const LINE_DECIMAL_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export type AvgPrSizeMode = "additions" | "net";

export function useAvgPrSizeMetrics(organization: OrganizationAnalytics) {
  const [mode, setMode] = useState<AvgPrSizeMode>("additions");

  const { additionsDisplay, deletionsDisplay, additionsMetric, netMetric } =
    useMemo(() => {
      const baseMetric = organization.metrics.avgPrSize;
      const breakdown = baseMetric.breakdown ?? [];
      const additionsEntry = breakdown.find(
        (entry) => entry.label === "+ 합계",
      );
      const deletionsEntry = breakdown.find(
        (entry) => entry.label === "- 합계",
      );

      const fallbackCurrent = roundToOneDecimal(baseMetric.current ?? 0);
      const fallbackPrevious = roundToOneDecimal(baseMetric.previous ?? 0);

      const additionsCurrent = roundToOneDecimal(
        Number(additionsEntry?.current ?? fallbackCurrent),
      );
      const additionsPrevious = roundToOneDecimal(
        Number(additionsEntry?.previous ?? fallbackPrevious),
      );
      const deletionsCurrent = roundToOneDecimal(
        Number(deletionsEntry?.current ?? 0),
      );
      const deletionsPrevious = roundToOneDecimal(
        Number(deletionsEntry?.previous ?? 0),
      );

      const netCurrent = roundToOneDecimal(additionsCurrent - deletionsCurrent);
      const netPrevious = roundToOneDecimal(
        additionsPrevious - deletionsPrevious,
      );

      const toComparisonValue = (
        current: number,
        previous: number,
      ): ComparisonValue => {
        const absoluteChange = roundToOneDecimal(current - previous);
        const percentChange =
          previous === 0 ? null : (current - previous) / previous;
        const value: ComparisonValue = {
          current,
          previous,
          absoluteChange,
          percentChange,
        };
        if (breakdown.length) {
          value.breakdown = breakdown;
        }
        return value;
      };

      return {
        additionsDisplay: LINE_DECIMAL_FORMATTER.format(additionsCurrent),
        deletionsDisplay: LINE_DECIMAL_FORMATTER.format(deletionsCurrent),
        additionsMetric: toComparisonValue(additionsCurrent, additionsPrevious),
        netMetric: toComparisonValue(netCurrent, netPrevious),
      };
    }, [organization.metrics.avgPrSize]);

  const valueLabel = `+${additionsDisplay} / -${deletionsDisplay} 라인`;
  const metric = mode === "additions" ? additionsMetric : netMetric;
  const history = useMemo(
    () =>
      toCardHistory(
        mode === "additions"
          ? organization.metricHistory.avgPrAdditions
          : organization.metricHistory.avgPrNet,
      ),
    [
      mode,
      organization.metricHistory.avgPrAdditions,
      organization.metricHistory.avgPrNet,
    ],
  );

  return {
    mode,
    setMode,
    valueLabel,
    metric,
    history,
  };
}

export type RepoSortKey =
  | "issuesCreated"
  | "issuesResolved"
  | "pullRequestsCreated"
  | "pullRequestsMerged"
  | "reviews"
  | "activeReviews"
  | "comments"
  | "avgFirstReviewHours";

export type RepoSortDirection = "asc" | "desc";

const REPO_SORT_DEFAULT_DIRECTION: Record<RepoSortKey, RepoSortDirection> = {
  issuesCreated: "desc",
  issuesResolved: "desc",
  pullRequestsCreated: "desc",
  pullRequestsMerged: "desc",
  reviews: "desc",
  activeReviews: "desc",
  comments: "desc",
  avgFirstReviewHours: "asc",
};

export function useRepoComparisonSort(rows: RepoComparisonRow[]) {
  const [repoSort, setRepoSort] = useState<{
    key: RepoSortKey;
    direction: RepoSortDirection;
  }>(() => ({
    key: "issuesResolved",
    direction: REPO_SORT_DEFAULT_DIRECTION.issuesResolved,
  }));

  const sorted = useMemo(() => {
    const list = [...rows];
    const { key, direction } = repoSort;

    const getValue = (row: (typeof list)[number]): number | null => {
      switch (key) {
        case "issuesCreated":
          return row.issuesCreated;
        case "issuesResolved":
          return row.issuesResolved;
        case "pullRequestsCreated":
          return row.pullRequestsCreated;
        case "pullRequestsMerged":
          return row.pullRequestsMerged;
        case "reviews":
          return row.reviews;
        case "activeReviews":
          return row.activeReviews;
        case "comments":
          return row.comments;
        case "avgFirstReviewHours":
          return row.avgFirstReviewHours;
        default:
          return null;
      }
    };

    return list.sort((a, b) => {
      const valueA = getValue(a);
      const valueB = getValue(b);

      if (valueA == null && valueB == null) {
        const nameA = a.repository?.nameWithOwner ?? a.repositoryId;
        const nameB = b.repository?.nameWithOwner ?? b.repositoryId;
        return nameA.localeCompare(nameB);
      }

      if (valueA == null) {
        return 1;
      }

      if (valueB == null) {
        return -1;
      }

      if (valueA === valueB) {
        const nameA = a.repository?.nameWithOwner ?? a.repositoryId;
        const nameB = b.repository?.nameWithOwner ?? b.repositoryId;
        return nameA.localeCompare(nameB);
      }

      return direction === "asc" ? valueA - valueB : valueB - valueA;
    });
  }, [repoSort, rows]);

  const toggle = (key: RepoSortKey) => {
    setRepoSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        key,
        direction: REPO_SORT_DEFAULT_DIRECTION[key] ?? "desc",
      };
    });
  };

  return { repoSort, setRepoSort, toggle, sorted };
}

export type MainBranchSortKey = "count" | "additions" | "net";

function getLeaderboardDetailValue(entry: LeaderboardEntry, label: string) {
  if (!entry.details) {
    return 0;
  }
  const detail = entry.details.find((item) => item.label === label);
  return Number(detail?.value ?? 0);
}

export function useMainBranchContributionSort(
  rawMainBranchContributionEntries: LeaderboardEntry[],
  rawActiveMainBranchContributionEntries: LeaderboardEntry[],
) {
  const [mainBranchSortKey, setMainBranchSortKey] =
    useState<MainBranchSortKey>("count");
  const [activeMainBranchSortKey, setActiveMainBranchSortKey] =
    useState<MainBranchSortKey>("count");

  const mainBranchContributionEntries = useMemo(() => {
    const getSortValue = (entry: LeaderboardEntry) => {
      if (mainBranchSortKey === "additions") {
        return getLeaderboardDetailValue(entry, "+");
      }

      if (mainBranchSortKey === "net") {
        return (
          getLeaderboardDetailValue(entry, "+") -
          getLeaderboardDetailValue(entry, "-")
        );
      }

      return entry.value;
    };

    const getName = (entry: LeaderboardEntry) =>
      entry.user.login ?? entry.user.name ?? entry.user.id;

    return [...rawMainBranchContributionEntries].sort((a, b) => {
      const valueA = getSortValue(a);
      const valueB = getSortValue(b);

      if (valueA === valueB) {
        return getName(a).localeCompare(getName(b));
      }

      return valueB - valueA;
    });
  }, [mainBranchSortKey, rawMainBranchContributionEntries]);

  const activeMainBranchContributionEntries = useMemo(() => {
    const getSortValue = (entry: LeaderboardEntry) => {
      if (activeMainBranchSortKey === "additions") {
        return getLeaderboardDetailValue(entry, "+");
      }

      if (activeMainBranchSortKey === "net") {
        return (
          getLeaderboardDetailValue(entry, "+") -
          getLeaderboardDetailValue(entry, "-")
        );
      }

      return entry.value;
    };

    const getName = (entry: LeaderboardEntry) =>
      entry.user.login ?? entry.user.name ?? entry.user.id;

    return [...rawActiveMainBranchContributionEntries].sort((a, b) => {
      const valueA = getSortValue(a);
      const valueB = getSortValue(b);

      if (valueA === valueB) {
        return getName(a).localeCompare(getName(b));
      }

      return valueB - valueA;
    });
  }, [activeMainBranchSortKey, rawActiveMainBranchContributionEntries]);

  return {
    mainBranchSortKey,
    setMainBranchSortKey,
    activeMainBranchSortKey,
    setActiveMainBranchSortKey,
    mainBranchContributionEntries,
    activeMainBranchContributionEntries,
  };
}

export type MainBranchSortOption = {
  key: MainBranchSortKey;
  label: string;
};

export type RepoComparisonColumn = {
  key: RepoSortKey;
  label: string;
  className?: string;
  render: (row: RepoComparisonRow) => ReactNode;
};

export const REPO_METRIC_COLUMN_CLASS = "w-[7.25rem]";
export type AvgPrSizeMetrics = ReturnType<typeof useAvgPrSizeMetrics>;

export function useDateKeys(start: string, end: string) {
  return useMemo(() => buildDateKeys(start, end), [start, end]);
}

export function usePrMergedSort(rawPrMergedEntries: LeaderboardEntry[]) {
  const [prMergedSortKey, setPrMergedSortKey] =
    useState<MainBranchSortKey>("count");

  const prMergedEntries = useMemo(() => {
    const getSortValue = (entry: LeaderboardEntry) => {
      if (prMergedSortKey === "additions") {
        return getLeaderboardDetailValue(entry, "+");
      }

      if (prMergedSortKey === "net") {
        return (
          getLeaderboardDetailValue(entry, "+") -
          getLeaderboardDetailValue(entry, "-")
        );
      }

      return entry.value;
    };

    const getName = (entry: LeaderboardEntry) =>
      entry.user.login ?? entry.user.name ?? entry.user.id;

    return [...rawPrMergedEntries].sort((a, b) => {
      const valueA = getSortValue(a);
      const valueB = getSortValue(b);

      if (valueA === valueB) {
        return getName(a).localeCompare(getName(b));
      }

      return valueB - valueA;
    });
  }, [prMergedSortKey, rawPrMergedEntries]);

  return {
    prMergedSortKey,
    setPrMergedSortKey,
    prMergedEntries,
  };
}

export function useAnalyticsViewModel(analytics: DashboardAnalytics) {
  const organization = analytics.organization as OrganizationAnalytics;

  const avgPrSize = useAvgPrSizeMetrics(organization);
  const {
    repoSort,
    toggle: toggleRepoSort,
    sorted: sortedRepoComparison,
  } = useRepoComparisonSort(organization.repoComparison);
  const {
    mainBranchSortKey,
    setMainBranchSortKey,
    activeMainBranchSortKey,
    setActiveMainBranchSortKey,
    mainBranchContributionEntries,
    activeMainBranchContributionEntries,
  } = useMainBranchContributionSort(
    analytics.leaderboard.mainBranchContribution,
    analytics.leaderboard.activeMainBranchContribution,
  );
  const { prMergedEntries, prMergedSortKey, setPrMergedSortKey } =
    usePrMergedSort(analytics.leaderboard.prsMerged);

  const repoComparisonColumns = useMemo<RepoComparisonColumn[]>(() => {
    const columnClass = REPO_METRIC_COLUMN_CLASS;
    return [
      {
        key: "issuesCreated",
        label: "이슈 생성",
        render: (row) => formatNumber(row.issuesCreated),
        className: columnClass,
      },
      {
        key: "issuesResolved",
        label: "이슈 종료",
        render: (row) => formatNumber(row.issuesResolved),
        className: columnClass,
      },
      {
        key: "pullRequestsCreated",
        label: "PR 생성",
        render: (row) => formatNumber(row.pullRequestsCreated),
        className: columnClass,
      },
      {
        key: "pullRequestsMerged",
        label: "PR 머지",
        render: (row) => formatNumber(row.pullRequestsMerged),
        className: columnClass,
      },
      {
        key: "reviews",
        label: "리뷰",
        render: (row) => formatNumber(row.reviews),
        className: columnClass,
      },
      {
        key: "activeReviews",
        label: "적극 리뷰",
        render: (row) => formatNumber(row.activeReviews),
        className: columnClass,
      },
      {
        key: "comments",
        label: "댓글",
        render: (row) => formatNumber(row.comments),
        className: columnClass,
      },
      {
        key: "avgFirstReviewHours",
        label: "평균 첫 리뷰(시간)",
        render: (row) =>
          row.avgFirstReviewHours == null
            ? "–"
            : formatDuration(row.avgFirstReviewHours, "hours"),
        className: "w-[8.5rem]",
      },
    ];
  }, []);

  const issuesNetTrend = useMemo(() => {
    const issuesLineData = mergeTrends(
      organization.trends.issuesCreated,
      organization.trends.issuesClosed,
      "created",
      "closed",
    );
    const dateKeys = buildDateKeys(analytics.range.start, analytics.range.end);
    return buildNetTrend(dateKeys, issuesLineData, "created", "closed");
  }, [
    analytics.range.end,
    analytics.range.start,
    organization.trends.issuesClosed,
    organization.trends.issuesCreated,
  ]);

  const prNetTrend = useMemo(() => {
    const prLineData = mergeTrends(
      organization.trends.prsCreated,
      organization.trends.prsMerged,
      "created",
      "merged",
    );
    const dateKeys = buildDateKeys(analytics.range.start, analytics.range.end);
    return buildNetTrend(dateKeys, prLineData, "created", "merged");
  }, [
    analytics.range.end,
    analytics.range.start,
    organization.trends.prsCreated,
    organization.trends.prsMerged,
  ]);

  const reviewerLeaderboardEntries = useMemo(() => {
    return organization.reviewers
      .filter((reviewer) => reviewer.reviewCount > 0)
      .map((reviewer) => ({
        user: reviewer.profile ?? {
          id: reviewer.reviewerId,
          login: null,
          name: null,
          avatarUrl: null,
        },
        value: reviewer.reviewCount,
        secondaryValue: reviewer.pullRequestsReviewed,
      }));
  }, [organization.reviewers]);

  const activeReviewerLeaderboardEntries = useMemo(() => {
    const entries = [...analytics.leaderboard.activeReviewerActivity];
    return entries.sort((a, b) => {
      if (b.value === a.value) {
        const nameA = a.user.login ?? a.user.name ?? a.user.id;
        const nameB = b.user.login ?? b.user.name ?? b.user.id;
        return nameA.localeCompare(nameB);
      }
      return b.value - a.value;
    });
  }, [analytics.leaderboard.activeReviewerActivity]);

  return {
    organization,
    avgPrSize,
    repoComparisonColumns,
    repoMetricColumnClass: REPO_METRIC_COLUMN_CLASS,
    repoSort,
    toggleRepoSort,
    sortedRepoComparison,
    issuesNetTrend,
    prNetTrend,
    reviewHeatmap: organization.trends.reviewHeatmap,
    reviewerLeaderboardEntries,
    activeReviewerLeaderboardEntries,
    prMergedEntries,
    prMergedSortKey,
    setPrMergedSortKey,
    mainBranchSortKey,
    setMainBranchSortKey,
    activeMainBranchSortKey,
    setActiveMainBranchSortKey,
    mainBranchContributionEntries,
    activeMainBranchContributionEntries,
    individual: analytics.individual,
  };
}
