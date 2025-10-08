"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useMemo,
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
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import {
  type MainBranchSortKey,
  type RepoSortKey,
  useAvgPrSizeMetrics,
  useDateKeys,
  useMainBranchContributionSort,
  usePrMergedSort,
  useRepoComparisonSort,
} from "@/components/dashboard/analytics-view.model";
import { DashboardFilterPanel } from "@/components/dashboard/dashboard-filter-panel";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import {
  individualMetricTooltips,
  organizationMetricTooltips,
} from "@/components/dashboard/metric-tooltips";
import { RepoDistributionList } from "@/components/dashboard/repo-distribution-list";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatDuration,
  formatNumber,
} from "@/lib/dashboard/metric-formatters";
import { buildNetTrend, mergeTrends } from "@/lib/dashboard/trend-utils";
import type {
  DashboardAnalytics,
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

function _roundToOneDecimal(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 10) / 10;
}

function formatHoursAsDaysHours(value: number) {
  if (!Number.isFinite(value)) {
    return "–";
  }

  const safeHours = Math.max(0, value);
  if (safeHours * 60 < 1) {
    return "1분 미만";
  }

  const totalMinutes = Math.round(safeHours * 60);
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

function _getLeaderboardDetailValue(entry: LeaderboardEntry, label: string) {
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

  const {
    mode: avgPrSizeMode,
    setMode: setAvgPrSizeMode,
    valueLabel: avgPrSizeValueLabel,
    metric: avgPrSizeMetric,
    history: avgPrSizeHistory,
  } = useAvgPrSizeMetrics(organization);

  const avgPrSizeModeActions = (
    <div className="flex gap-1">
      <Button
        type="button"
        size="sm"
        variant={avgPrSizeMode === "additions" ? "default" : "outline"}
        aria-pressed={avgPrSizeMode === "additions"}
        onClick={() => setAvgPrSizeMode("additions")}
      >
        추가 라인
      </Button>
      <Button
        type="button"
        size="sm"
        variant={avgPrSizeMode === "net" ? "default" : "outline"}
        aria-pressed={avgPrSizeMode === "net"}
        onClick={() => setAvgPrSizeMode("net")}
      >
        순증 라인
      </Button>
    </div>
  );

  const {
    repoSort,
    toggle: toggleRepoSort,
    sorted: sortedRepoComparison,
  } = useRepoComparisonSort(organization.repoComparison);
  const dateKeys = useDateKeys(analytics.range.start, analytics.range.end);

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

  const { prMergedEntries, prMergedSortKey, setPrMergedSortKey } =
    usePrMergedSort(rawPrMergedEntries);
  const {
    mainBranchSortKey,
    setMainBranchSortKey,
    activeMainBranchSortKey,
    setActiveMainBranchSortKey,
    mainBranchContributionEntries,
    activeMainBranchContributionEntries,
  } = useMainBranchContributionSort(
    rawMainBranchContributionEntries,
    rawActiveMainBranchContributionEntries,
  );

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

  const issuesNetTrend = useMemo(
    () => buildNetTrend(dateKeys, issuesLineData, "created", "closed"),
    [dateKeys, issuesLineData],
  );

  const prLineData = mergeTrends(
    organization.trends.prsCreated,
    organization.trends.prsMerged,
    "created",
    "merged",
  );

  const prNetTrend = useMemo(
    () => buildNetTrend(dateKeys, prLineData, "created", "merged"),
    [dateKeys, prLineData],
  );

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
          title="PR 평균 크기"
          metric={avgPrSizeMetric}
          format="count"
          impact="negative"
          tooltip={organizationMetricTooltips.avgPrSize}
          history={avgPrSizeHistory}
          actions={avgPrSizeModeActions}
          valueOverride={avgPrSizeValueLabel}
        />
        <MetricCard
          title="PR 평균 댓글"
          metric={organization.metrics.avgCommentsPerPr}
          format="ratio"
          tooltip={organizationMetricTooltips.avgCommentsPerPr}
          history={toCardHistory(organization.metricHistory.avgCommentsPerPr)}
        />
        <MetricCard
          title="PR 평균 리뷰"
          metric={organization.metrics.avgReviewsPerPr}
          format="ratio"
          tooltip={organizationMetricTooltips.avgReviewsPerPr}
          history={toCardHistory(organization.metricHistory.avgReviewsPerPr)}
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
        <MetricCard
          title="리뷰 없는 머지 비율"
          metric={organization.metrics.mergeWithoutReviewRatio}
          format="percentage"
          tooltip={organizationMetricTooltips.mergeWithoutReviewRatio}
          history={toCardHistory(
            organization.metricHistory.mergeWithoutReviewRatio,
          )}
        />
        <MetricCard
          title="해결된 이슈 평균 댓글"
          metric={organization.metrics.avgCommentsPerIssue}
          format="ratio"
          tooltip={organizationMetricTooltips.avgCommentsPerIssue}
          history={toCardHistory(
            organization.metricHistory.avgCommentsPerIssue,
          )}
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
            <ActivityHeatmap data={reviewHeatmap} valueLabel="리뷰" />
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
            secondaryLabel="응답 수"
            secondaryUnit="건"
            tooltip={[
              "리뷰 요청 후 첫 응답(리뷰 제출, 댓글, 리액션 포함)까지 걸린 평균 시간입니다.",
              "주말과 지정 휴일에 발생한 응답은 0시간으로 계산되며",
              "Dependabot Pull Request는 포함하지 않습니다.",
            ].join(" ")}
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
            title="코멘트 참여"
            entries={analytics.leaderboard.discussionEngagement}
            tooltip={individualMetricTooltips.discussionComments}
          />
        </div>
      </section>
    </section>
  );
}
