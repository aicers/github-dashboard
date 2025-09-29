"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";
import {
  type Dispatch,
  Fragment,
  type ReactNode,
  type SetStateAction,
  useId,
  useMemo,
  useState,
} from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardFilterPanel } from "@/components/dashboard/dashboard-filter-panel";
import { buildRangeFromPreset } from "@/components/dashboard/dashboard-filters";
import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import {
  individualMetricTooltips,
  organizationMetricTooltips,
} from "@/components/dashboard/metric-tooltips";
import {
  formatDuration,
  formatNumber,
} from "@/components/dashboard/metric-utils";
import { RepoDistributionList } from "@/components/dashboard/repo-distribution-list";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DashboardAnalytics,
  HeatmapCell,
  LeaderboardEntry,
  OrganizationAnalytics,
  RepoComparisonRow,
} from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

type AnalyticsViewProps = {
  initialAnalytics: DashboardAnalytics;
  defaultRange: { start: string; end: string };
  orgName?: string | null;
};

type TrendEntry = Record<string, number> & { date: string };
type RepoSortKey =
  | "issuesCreated"
  | "issuesResolved"
  | "pullRequestsCreated"
  | "pullRequestsMerged"
  | "reviews"
  | "activeReviews"
  | "comments"
  | "avgFirstReviewHours";
type RepoSortDirection = "asc" | "desc";
type MainBranchSortKey = "count" | "additions" | "net";

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

const MAIN_BRANCH_SORT_OPTIONS: Array<{
  key: MainBranchSortKey;
  label: string;
}> = [
  {
    key: "count",
    label: "건수",
  },
  {
    key: "additions",
    label: "추가 라인",
  },
  {
    key: "net",
    label: "순증 라인",
  },
];

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, "0")}-${`${date.getUTCDate()}`.padStart(2, "0")}`;
}

function normalizeTrendDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return formatDateKey(parsed);
}

function buildDateKeys(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return [];
  }

  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const endUtc = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );

  const keys: string[] = [];
  for (let time = startUtc; time <= endUtc; time += DAY_IN_MS) {
    keys.push(formatDateKey(new Date(time)));
  }
  return keys;
}

function mergeTrends(
  left: { date: string; value: number }[],
  right: { date: string; value: number }[],
  leftKey: string,
  rightKey: string,
) {
  const map = new Map<string, TrendEntry>();

  const ensureEntry = (rawDate: string): TrendEntry => {
    const normalizedDate = normalizeTrendDateKey(rawDate);
    let entry = map.get(normalizedDate);
    if (!entry) {
      entry = {
        date: normalizedDate,
        [leftKey]: 0,
        [rightKey]: 0,
      } as TrendEntry;
      map.set(normalizedDate, entry);
    }
    return entry;
  };

  left.forEach((point) => {
    const entry = ensureEntry(point.date);
    entry[leftKey] = point.value;
  });

  right.forEach((point) => {
    const entry = ensureEntry(point.date);
    entry[rightKey] = point.value;
  });

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function Heatmap({ data }: { data: HeatmapCell[] }) {
  const max = data.reduce((acc, cell) => Math.max(acc, cell.count), 0);
  const cells = new Map<string, number>();
  data.forEach((cell) => {
    cells.set(`${cell.day}-${cell.hour}`, cell.count);
  });

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const dayIndices = Array.from({ length: 7 }, (_, day) => day);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[80px_repeat(24,minmax(16px,1fr))] gap-[3px]">
          <div />
          {hours.map((hour) => (
            <div
              key={`hour-${hour}`}
              className="text-center text-[10px] text-muted-foreground"
            >
              {hour}
            </div>
          ))}
          {dayIndices.map((dayIndex) => (
            <Fragment key={`day-${dayIndex}`}>
              <div className="flex items-center justify-end pr-2 text-xs text-muted-foreground">
                {days[dayIndex]}
              </div>
              {hours.map((hour) => {
                const key = `${dayIndex}-${hour}`;
                const count = cells.get(key) ?? 0;
                const intensity = max === 0 ? 0 : count / max;
                const background = `rgba(59, 130, 246, ${Math.max(intensity * 0.85, 0.05)})`;
                return (
                  <div
                    key={`cell-${key}`}
                    className="h-[18px] rounded-sm"
                    style={{
                      backgroundColor: intensity === 0 ? "#F3F4F6" : background,
                    }}
                    title={`${days[dayIndex]} ${hour}시: ${count.toLocaleString()} 리뷰`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatHoursAsDaysHours(value: number) {
  if (!Number.isFinite(value)) {
    return "–";
  }

  const totalMinutes = Math.max(0, Math.round(value * 60));
  let days = Math.floor(totalMinutes / (24 * 60));
  const remainingMinutes = totalMinutes - days * 24 * 60;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes - hours * 60;

  if (hours === 24) {
    days += 1;
  }

  let carryHours = hours;
  let carryMinutes = minutes;
  if (carryMinutes === 60) {
    carryHours += 1;
    carryMinutes = 0;
  }

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}일`);
  }
  parts.push(`${carryHours}시간`);
  parts.push(`${carryMinutes}분`);
  return parts.join(" ");
}

function formatReviewsPerPr(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const digits = safeValue >= 10 ? 0 : safeValue >= 1 ? 1 : 2;
  return `${safeValue.toFixed(digits)}건/PR`;
}

function LeaderboardTable({
  title,
  entries,
  unit,
  valueFormatter,
  secondaryLabel,
  tooltip,
  headerActions,
}: {
  title: string;
  entries: LeaderboardEntry[];
  unit?: string;
  valueFormatter?: (value: number) => string;
  secondaryLabel?: string;
  tooltip?: string;
  headerActions?: ReactNode;
}) {
  const tooltipId = useId();
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1 text-base font-medium">
          <span>{title}</span>
          {tooltip && (
            <button
              type="button"
              aria-describedby={tooltipId}
              aria-label={tooltip}
              className="group relative inline-flex cursor-help items-center bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              <span
                id={tooltipId}
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-20 w-52 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {tooltip}
              </span>
            </button>
          )}
        </CardTitle>
        {headerActions ? <CardAction>{headerActions}</CardAction> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>
        )}
        {entries.map((entry, index) => (
          <div key={entry.user.id} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-muted-foreground">{index + 1}</span>
            <div className="flex flex-col flex-1">
              <span className="font-medium">
                {entry.user.login ?? entry.user.name ?? entry.user.id}
              </span>
              {entry.user.name && entry.user.login && (
                <span className="text-xs text-muted-foreground whitespace-pre-line">
                  {entry.user.name}
                </span>
              )}
            </div>
            <div className="flex flex-col items-end text-right">
              <span className="font-semibold">
                {valueFormatter
                  ? valueFormatter(entry.value)
                  : `${formatNumber(entry.value)}${unit ?? ""}`}
              </span>
              {(secondaryLabel && entry.secondaryValue != null) ||
              entry.details?.length ? (
                <div className="flex flex-col items-end text-right text-xs text-muted-foreground">
                  {(() => {
                    const lines: string[] = [];
                    const countParts: string[] = [];
                    const lineParts: string[] = [];

                    if (secondaryLabel && entry.secondaryValue != null) {
                      countParts.push(
                        `${secondaryLabel} ${formatNumber(entry.secondaryValue)}${unit ?? ""}`,
                      );
                    }

                    entry.details?.forEach((detail) => {
                      const suffix = detail.suffix ?? "";
                      const prefix =
                        detail.sign === "positive"
                          ? "+"
                          : detail.sign === "negative"
                            ? "-"
                            : "";
                      const isLineDetail =
                        detail.label === "+" || detail.label === "-";
                      const numberText = `${prefix}${formatNumber(detail.value)}${suffix}`;
                      const display = isLineDetail
                        ? `${detail.label}${formatNumber(detail.value)}${suffix}`
                        : `${detail.label} ${numberText}`;
                      if (isLineDetail) {
                        lineParts.push(display);
                      } else {
                        countParts.push(display);
                      }
                    });

                    if (countParts.length > 0) {
                      lines.push(countParts.join(" · "));
                    }
                    if (lineParts.length > 0) {
                      lines.push(lineParts.join(" · "));
                    }

                    return lines.map((text) => <span key={text}>{text}</span>);
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function getLeaderboardDetailValue(entry: LeaderboardEntry, label: string) {
  if (!entry.details) {
    return 0;
  }
  const detail = entry.details.find((item) => item.label === label);
  return Number(detail?.value ?? 0);
}

export function AnalyticsView({
  initialAnalytics,
  defaultRange,
  orgName,
}: AnalyticsViewProps) {
  const {
    analytics,
    filters,
    setFilters,
    applyFilters,
    isLoading,
    error,
    timeZone,
    weekStart,
  } = useDashboardAnalytics({ initialAnalytics, defaultRange });

  const repositories = analytics.repositories;
  const contributors = analytics.contributors;

  const organization = analytics.organization as OrganizationAnalytics;

  const [repoSort, setRepoSort] = useState<{
    key: RepoSortKey;
    direction: RepoSortDirection;
  }>(() => ({
    key: "issuesResolved",
    direction: REPO_SORT_DEFAULT_DIRECTION.issuesResolved,
  }));

  const [mainBranchSortKey, setMainBranchSortKey] =
    useState<MainBranchSortKey>("count");
  const [activeMainBranchSortKey, setActiveMainBranchSortKey] =
    useState<MainBranchSortKey>("count");

  const dateKeys = useMemo(
    () => buildDateKeys(analytics.range.start, analytics.range.end),
    [analytics.range.start, analytics.range.end],
  );

  const sortedRepoComparison = useMemo(() => {
    const rows = [...organization.repoComparison];
    const { key, direction } = repoSort;

    const getValue = (row: (typeof rows)[number]): number | null => {
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

    return rows.sort((a, b) => {
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
  }, [organization.repoComparison, repoSort]);

  const toggleRepoSort = (key: RepoSortKey) => {
    setRepoSort((previous) => {
      if (previous.key === key) {
        return {
          key,
          direction: previous.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        key,
        direction: REPO_SORT_DEFAULT_DIRECTION[key],
      };
    });
  };

  const getRepoSortAria = (
    key: RepoSortKey,
  ): "ascending" | "descending" | "none" => {
    if (repoSort.key !== key) {
      return "none";
    }
    return repoSort.direction === "asc" ? "ascending" : "descending";
  };

  const renderRepoSortIcon = (key: RepoSortKey) => {
    if (repoSort.key !== key) {
      return <ArrowUpDown className="h-3 w-3" aria-hidden="true" />;
    }

    return repoSort.direction === "asc" ? (
      <ArrowUp className="h-3 w-3" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden="true" />
    );
  };

  const repoMetricColumnClass = "w-[7.25rem]";

  const repoComparisonColumns: Array<{
    key: RepoSortKey;
    label: string;
    render: (row: RepoComparisonRow) => ReactNode;
    className?: string;
  }> = [
    {
      key: "issuesCreated",
      label: "이슈 생성",
      render: (row) => formatNumber(row.issuesCreated),
      className: repoMetricColumnClass,
    },
    {
      key: "issuesResolved",
      label: "이슈 해결",
      render: (row) => formatNumber(row.issuesResolved),
      className: repoMetricColumnClass,
    },
    {
      key: "pullRequestsCreated",
      label: "PR 생성",
      render: (row) => formatNumber(row.pullRequestsCreated),
      className: repoMetricColumnClass,
    },
    {
      key: "pullRequestsMerged",
      label: "PR 머지",
      render: (row) => formatNumber(row.pullRequestsMerged),
      className: repoMetricColumnClass,
    },
    {
      key: "reviews",
      label: "리뷰",
      render: (row) => formatNumber(row.reviews),
      className: repoMetricColumnClass,
    },
    {
      key: "activeReviews",
      label: "적극 리뷰",
      render: (row) => formatNumber(row.activeReviews),
      className: repoMetricColumnClass,
    },
    {
      key: "comments",
      label: "댓글",
      render: (row) => formatNumber(row.comments),
      className: repoMetricColumnClass,
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

  const reviewerLeaderboardEntries: LeaderboardEntry[] = organization.reviewers
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

  const rawPrMergedEntries = analytics.leaderboard.prsMerged;
  const rawMainBranchContributionEntries =
    analytics.leaderboard.mainBranchContribution;
  const rawActiveMainBranchContributionEntries =
    analytics.leaderboard.activeMainBranchContribution;

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
  }, [rawPrMergedEntries, prMergedSortKey]);

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
  }, [rawMainBranchContributionEntries, mainBranchSortKey]);

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
  }, [rawActiveMainBranchContributionEntries, activeMainBranchSortKey]);

  const renderMainBranchSortControls = (
    sortKey: MainBranchSortKey,
    onSortChange: Dispatch<SetStateAction<MainBranchSortKey>>,
  ) => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden font-medium md:inline">정렬</span>
      <div className="flex rounded-md border border-border/60 bg-background/80 p-0.5">
        {MAIN_BRANCH_SORT_OPTIONS.map((option) => {
          const isActive = sortKey === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onSortChange(option.key)}
              className={cn(
                "rounded-[6px] px-2 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={isActive}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const prMergedSortControls = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden font-medium md:inline">정렬</span>
      <div className="flex rounded-md border border-border/60 bg-background/80 p-0.5">
        {MAIN_BRANCH_SORT_OPTIONS.map((option) => {
          const isActive = prMergedSortKey === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setPrMergedSortKey(option.key)}
              className={cn(
                "rounded-[6px] px-2 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const issuesLineData = mergeTrends(
    organization.trends.issuesCreated,
    organization.trends.issuesClosed,
    "created",
    "closed",
  );

  const issuesNetTrend = useMemo(() => {
    const map = new Map(issuesLineData.map((entry) => [entry.date, entry]));
    return dateKeys.map((date) => {
      const entry = map.get(date);
      const created = entry?.created ?? 0;
      const closed = entry?.closed ?? 0;
      return {
        date,
        delta: created - closed,
      };
    });
  }, [dateKeys, issuesLineData]);

  const prLineData = mergeTrends(
    organization.trends.prsCreated,
    organization.trends.prsMerged,
    "created",
    "merged",
  );

  const prNetTrend = useMemo(() => {
    const map = new Map(prLineData.map((entry) => [entry.date, entry]));
    return dateKeys.map((date) => {
      const entry = map.get(date);
      const created = entry?.created ?? 0;
      const merged = entry?.merged ?? 0;
      return {
        date,
        delta: created - merged,
      };
    });
  }, [dateKeys, prLineData]);

  const reviewHeatmap = organization.trends.reviewHeatmap;

  const individual = analytics.individual;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">GitHub 활동 분석</h1>
            <p className="text-sm text-muted-foreground">
              {orgName ? `${orgName} 조직의 활동 지표` : "조직 활동 지표"}
            </p>
          </div>
        </div>

        <DashboardFilterPanel
          filters={filters}
          setFilters={setFilters}
          onApply={() => {
            void applyFilters();
          }}
          isLoading={isLoading}
          error={error}
          repositories={repositories}
          contributors={contributors}
          range={analytics.range}
          showPersonSelector={false}
          timeZone={timeZone}
          weekStart={weekStart}
        />
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          title="이슈 생성"
          metric={organization.metrics.issuesCreated}
          format="count"
          impact="positive"
          tooltip={organizationMetricTooltips.issuesCreated}
          history={toCardHistory(organization.metricHistory.issuesCreated)}
        />
        <MetricCard
          title="이슈 종료"
          metric={organization.metrics.issuesClosed}
          format="count"
          impact="positive"
          tooltip={organizationMetricTooltips.issuesClosed}
          history={toCardHistory(organization.metricHistory.issuesClosed)}
        />
        <MetricCard
          title="평균 해결 시간"
          metric={organization.metrics.issueResolutionTime}
          format="hours"
          impact="negative"
          tooltip={organizationMetricTooltips.issueResolutionTime}
          history={toCardHistory(
            organization.metricHistory.issueResolutionTime,
          )}
        />
        <MetricCard
          title="평균 작업 시간"
          metric={organization.metrics.issueWorkTime}
          format="hours"
          impact="negative"
          tooltip={organizationMetricTooltips.issueWorkTime}
          history={toCardHistory(organization.metricHistory.issueWorkTime)}
        />
        <MetricCard
          title="PR 생성"
          metric={organization.metrics.prsCreated}
          format="count"
          impact="positive"
          tooltip={organizationMetricTooltips.prsCreated}
          history={toCardHistory(organization.metricHistory.prsCreated)}
        />
        <MetricCard
          title="PR 머지"
          metric={organization.metrics.prsMerged}
          format="count"
          impact="positive"
          tooltip={organizationMetricTooltips.prsMerged}
          history={toCardHistory(organization.metricHistory.prsMerged)}
        />
        <MetricCard
          title="리뷰 참여 비율"
          metric={organization.metrics.reviewParticipation}
          format="percentage"
          tooltip={organizationMetricTooltips.reviewParticipation}
          history={toCardHistory(
            organization.metricHistory.reviewParticipation,
          )}
        />
        <MetricCard
          title="리뷰 응답 시간"
          metric={organization.metrics.reviewResponseTime}
          format="hours"
          impact="negative"
          tooltip={organizationMetricTooltips.reviewResponseTime}
          history={toCardHistory(organization.metricHistory.reviewResponseTime)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Parent / Child 이슈 지표</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Parent 이슈 해결 시간"
            metric={organization.metrics.parentIssueResolutionTime}
            format="hours"
            impact="negative"
            tooltip={organizationMetricTooltips.parentIssueResolutionTime}
            history={toCardHistory(
              organization.metricHistory.parentIssueResolutionTime,
            )}
          />
          <MetricCard
            title="Parent 이슈 작업 시간"
            metric={organization.metrics.parentIssueWorkTime}
            format="hours"
            impact="negative"
            tooltip={organizationMetricTooltips.parentIssueWorkTime}
            history={toCardHistory(
              organization.metricHistory.parentIssueWorkTime,
            )}
          />
          <MetricCard
            title="Child 이슈 해결 시간"
            metric={organization.metrics.childIssueResolutionTime}
            format="hours"
            impact="negative"
            tooltip={organizationMetricTooltips.childIssueResolutionTime}
            history={toCardHistory(
              organization.metricHistory.childIssueResolutionTime,
            )}
          />
          <MetricCard
            title="Child 이슈 작업 시간"
            metric={organization.metrics.childIssueWorkTime}
            format="hours"
            impact="negative"
            tooltip={organizationMetricTooltips.childIssueWorkTime}
            history={toCardHistory(
              organization.metricHistory.childIssueWorkTime,
            )}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              이슈 순증 추이
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              선택한 기간 동안 일별 이슈 생성 대비 종료(생성-종료) 변화량
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={issuesNetTrend}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--muted-foreground) / 0.2)"
                />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                />
                <Tooltip />
                <ReferenceLine
                  y={0}
                  stroke="hsl(var(--muted-foreground) / 0.6)"
                  strokeDasharray="4 4"
                />
                <Line
                  type="monotone"
                  dataKey="delta"
                  name="순증(생성-종료)"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              PR 순증 추이
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              기간 중 일별 PR 생성 대비 머지(생성-머지) 변화량
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={prNetTrend}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--muted-foreground) / 0.2)"
                />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                />
                <Tooltip />
                <ReferenceLine
                  y={0}
                  stroke="hsl(var(--muted-foreground) / 0.6)"
                  strokeDasharray="4 4"
                />
                <Line
                  type="monotone"
                  dataKey="delta"
                  name="순증(생성-머지)"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              리뷰 활동 히트맵
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              요일/시간대별 리뷰 집중도
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Heatmap data={reviewHeatmap} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              리포지토리 비교
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              리포지토리별 이슈 생성·해결, PR 생성·머지, 리뷰·댓글, 첫
              리뷰까지의 평균 시간을 비교합니다. Dependabot이 생성한 Pull
              Request는 제외됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-3" scope="col">
                    리포지토리
                  </th>
                  {repoComparisonColumns.map((column) => (
                    <th
                      key={column.key}
                      className={cn("pb-3 px-3 text-right", column.className)}
                      aria-sort={getRepoSortAria(column.key)}
                      scope="col"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRepoSort(column.key)}
                        className="flex w-full items-center justify-end gap-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
                      >
                        <span>{column.label}</span>
                        {renderRepoSortIcon(column.key)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sortedRepoComparison.map((row) => (
                  <tr key={row.repositoryId} className="h-12">
                    <td className="pr-4">
                      {row.repository?.nameWithOwner ?? row.repositoryId}
                    </td>
                    {repoComparisonColumns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-3 text-right tabular-nums",
                          column.className,
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              협업 품질 지표
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Dependabot이 생성한 Pull Request는 해당 지표 계산에서 제외됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>머지된 PR 평균 크기</span>
              <span className="font-medium">
                {formatNumber(organization.metrics.avgPrSize.current)} 라인
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>머지된 PR 평균 댓글</span>
              <span className="font-medium">
                {organization.metrics.avgCommentsPerPr.current.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>해결된 이슈 평균 댓글</span>
              <span className="font-medium">
                {organization.metrics.avgCommentsPerIssue.current.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>머지된 PR 리뷰 참여 비율</span>
              <span className="font-medium">
                {(
                  organization.metrics.reviewParticipation.current * 100
                ).toFixed(1)}
                %
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>리뷰 없는 머지 비율</span>
              <span className="font-medium">
                {(
                  organization.metrics.mergeWithoutReviewRatio.current * 100
                ).toFixed(1)}
                %
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {individual && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-2xl font-semibold">
              {individual.person.login ??
                individual.person.name ??
                individual.person.id}
              님 활동
            </h2>
            <p className="text-sm text-muted-foreground">
              개인의 이슈·리뷰 기여도와 협업 지표를 확인합니다.
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="이슈 생성"
              metric={individual.metrics.issuesCreated}
              format="count"
            />
            <MetricCard
              title="이슈 종료"
              metric={individual.metrics.issuesClosed}
              format="count"
            />
            <MetricCard
              title="평균 해결 시간"
              metric={individual.metrics.issueResolutionTime}
              format="hours"
              impact="negative"
            />
            <MetricCard
              title="리뷰 수행"
              metric={individual.metrics.reviewsCompleted}
              format="count"
            />
            <MetricCard
              title="PR 리뷰 커버리지"
              metric={individual.metrics.reviewCoverage}
              format="percentage"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base font-medium">
                  월별 기여 추이
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={individual.trends.monthly}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--muted-foreground) / 0.2)"
                    />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                    />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="values.issues"
                      name="이슈"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="values.reviews"
                      name="리뷰"
                      stroke="#16a34a"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base font-medium">
                  리포지토리 활동
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  해당 기간 동안 활동이 집중된 리포지토리
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RepoDistributionList
                  items={individual.trends.repoActivity.slice(0, 8)}
                />
              </CardContent>
            </Card>
          </section>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">리더보드</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <LeaderboardTable
            title="적극 리뷰어 활동"
            entries={activeReviewerLeaderboardEntries}
            valueFormatter={(value) => `${formatNumber(value)}건`}
            unit="건"
            tooltip="APPROVED 상태로 제출된 리뷰만 집계합니다."
          />
          <LeaderboardTable
            title="리뷰어 활동"
            entries={reviewerLeaderboardEntries}
            valueFormatter={(value) => `${formatNumber(value)}건`}
            secondaryLabel="참여 PR"
            unit="건"
            tooltip="APPROVED, CHANGES_REQUESTED, COMMENTED 리뷰를 모두 포함하며 DISMISSED는 제외합니다. 적극 리뷰어 활동은 이 중 APPROVED만 집계합니다."
          />
          <LeaderboardTable
            title="적극 메인 브랜치 기여"
            entries={activeMainBranchContributionEntries}
            valueFormatter={(value) => `${formatNumber(value)}건`}
            secondaryLabel="승인 리뷰"
            unit="건"
            tooltip="머지된 PR 기여에 더해 APPROVED 상태 리뷰만 집계합니다. Dependabot Pull Request는 제외됩니다."
            headerActions={renderMainBranchSortControls(
              activeMainBranchSortKey,
              setActiveMainBranchSortKey,
            )}
          />
          <LeaderboardTable
            title="메인 브랜치 기여"
            entries={mainBranchContributionEntries}
            valueFormatter={(value) => `${formatNumber(value)}건`}
            secondaryLabel="리뷰"
            unit="건"
            tooltip={[
              "머지된 PR에 대한 직접 기여를 더하고",
              "리뷰 참여는 APPROVED, CHANGES_REQUESTED, COMMENTED만 포함합니다 (DISMISSED 제외).",
              "적극 메인 브랜치 기여는 여기서 APPROVED만 집계합니다.",
              "+/− 값은 병합된 PR의 코드 추가·삭제 라인 합계이며",
              "Dependabot Pull Request는 제외됩니다.",
            ].join("\n")}
            headerActions={renderMainBranchSortControls(
              mainBranchSortKey,
              setMainBranchSortKey,
            )}
          />
          <LeaderboardTable
            title="빠른 리뷰 응답"
            entries={analytics.leaderboard.fastestResponders}
            valueFormatter={formatHoursAsDaysHours}
            tooltip="리뷰 요청 후 첫 응답까지 걸린 평균 시간입니다. 주말과 지정 휴일을 제외하며 Dependabot Pull Request는 포함하지 않습니다."
          />
          <LeaderboardTable
            title="이슈 생성"
            entries={analytics.leaderboard.issuesCreated}
          />
          <LeaderboardTable
            title="PR 생성"
            entries={analytics.leaderboard.prsCreated}
          />
          <LeaderboardTable
            title="PR 머지"
            entries={prMergedEntries}
            headerActions={prMergedSortControls}
          />
          <LeaderboardTable
            title="PR 머지 수행"
            entries={analytics.leaderboard.prsMergedBy}
          />
          <LeaderboardTable
            title="PR 완성도"
            entries={analytics.leaderboard.prCompleteness}
            unit="건"
            secondaryLabel="PR 머지"
            valueFormatter={formatReviewsPerPr}
            tooltip={[
              "머지된 PR 한 건당 다른 리뷰어가 남긴 COMMENTED, CHANGES_REQUESTED 리뷰 수를 집계합니다.",
              "값이 낮을수록 PR이 깔끔하게 마무리된 것입니다.",
            ].join("\n")}
          />
          <LeaderboardTable
            title="토론 참여"
            entries={analytics.leaderboard.discussionEngagement}
            tooltip={individualMetricTooltips.discussionComments}
          />
        </div>
      </section>
    </section>
  );
}

export const __analyticsInternals = {
  formatDuration,
  buildRangeFromPreset,
  mergeTrends,
};
