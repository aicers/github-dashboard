"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
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
  type AvgPrSizeMetrics,
  type MainBranchSortKey,
  type RepoComparisonColumn,
  type RepoSortDirection,
  type RepoSortKey,
  useAnalyticsViewModel,
} from "@/components/dashboard/analytics-view.model";
import { DashboardFilterPanel } from "@/components/dashboard/dashboard-filter-panel";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  ORGANIZATION_METRIC_CARD_CONFIGS,
  PARENT_CHILD_METRIC_CARD_CONFIGS,
} from "@/components/dashboard/metric-card.config";
import { toCardHistory } from "@/components/dashboard/metric-history";
import {
  individualMetricTooltips,
  organizationMetricTooltips,
} from "@/components/dashboard/metric-tooltips";
import { RepoDistributionList } from "@/components/dashboard/repo-distribution-list";
import {
  type FilterState,
  useDashboardAnalytics,
} from "@/components/dashboard/use-dashboard-analytics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatNumber } from "@/lib/dashboard/metric-formatters";
import type {
  DashboardAnalytics,
  IndividualAnalytics,
  LeaderboardEntry,
  OrganizationAnalytics,
  RepoComparisonRow,
  WeekStart,
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

type SortToggleOption<Key extends string> = {
  key: Key;
  label: string;
};

type SortToggleGroupProps<Key extends string> = {
  value: Key;
  onChange: (next: Key) => void;
  options: Array<SortToggleOption<Key>>;
};

function SortToggleGroup<Key extends string>({
  value,
  onChange,
  options,
}: SortToggleGroupProps<Key>) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden font-medium md:inline">정렬</span>
      <div className="flex rounded-md border border-border/60 bg-background/80 p-0.5">
        {options.map((option) => {
          const isActive = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
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

  const {
    organization,
    avgPrSize,
    repoComparisonColumns,
    sortedRepoComparison,
    repoSort,
    toggleRepoSort,
    issuesNetTrend,
    prNetTrend,
    reviewHeatmap,
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
    individual,
  } = useAnalyticsViewModel(analytics);

  return (
    <section className="flex flex-col gap-8">
      <AnalyticsHeaderSection
        orgName={orgName}
        filters={filters}
        setFilters={setFilters}
        applyFilters={applyFilters}
        isLoading={isLoading}
        error={error}
        repositories={analytics.repositories}
        contributors={analytics.contributors}
        range={analytics.range}
        timeZone={timeZone}
        weekStart={weekStart}
      />

      <OrganizationMetricsSection
        organization={organization}
        avgPrSize={avgPrSize}
      />

      <TrendSection
        issuesNetTrend={issuesNetTrend}
        prNetTrend={prNetTrend}
        reviewHeatmap={reviewHeatmap}
      />

      <RepoComparisonSection
        columns={repoComparisonColumns}
        rows={sortedRepoComparison}
        repoSort={repoSort}
        onToggleSort={toggleRepoSort}
      />

      {individual && <IndividualSection individual={individual} />}

      <LeaderboardsSection
        analytics={analytics}
        reviewerEntries={reviewerLeaderboardEntries}
        activeReviewerEntries={activeReviewerLeaderboardEntries}
        mainBranchContributionEntries={mainBranchContributionEntries}
        activeMainBranchContributionEntries={
          activeMainBranchContributionEntries
        }
        mainBranchSortKey={mainBranchSortKey}
        setMainBranchSortKey={setMainBranchSortKey}
        activeMainBranchSortKey={activeMainBranchSortKey}
        setActiveMainBranchSortKey={setActiveMainBranchSortKey}
        prMergedEntries={prMergedEntries}
        prMergedSortKey={prMergedSortKey}
        setPrMergedSortKey={setPrMergedSortKey}
      />
    </section>
  );
}

type AnalyticsHeaderSectionProps = {
  orgName?: string | null;
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  applyFilters: (nextFilters?: FilterState) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  repositories: DashboardAnalytics["repositories"];
  contributors: DashboardAnalytics["contributors"];
  range: DashboardAnalytics["range"];
  timeZone: string;
  weekStart: WeekStart;
};

function AnalyticsHeaderSection({
  orgName,
  filters,
  setFilters,
  applyFilters,
  isLoading,
  error,
  repositories,
  contributors,
  range,
  timeZone,
  weekStart,
}: AnalyticsHeaderSectionProps) {
  return (
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
        range={range}
        showPersonSelector={false}
        timeZone={timeZone}
        weekStart={weekStart}
      />
    </header>
  );
}

type OrganizationMetricsSectionProps = {
  organization: OrganizationAnalytics;
  avgPrSize: AvgPrSizeMetrics;
};

function OrganizationMetricsSection({
  organization,
  avgPrSize,
}: OrganizationMetricsSectionProps) {
  const { mode, setMode, valueLabel, metric, history } = avgPrSize;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ORGANIZATION_METRIC_CARD_CONFIGS.slice(0, 6).map((config) => (
          <MetricCard
            key={config.key}
            title={config.title}
            metric={organization.metrics[config.key]}
            format={config.format}
            impact={config.impact}
            tooltip={organizationMetricTooltips[config.tooltipKey]}
            history={toCardHistory(
              organization.metricHistory[config.historyKey],
            )}
          />
        ))}
        <MetricCard
          title="PR 평균 크기"
          metric={metric}
          format="count"
          impact="negative"
          tooltip={organizationMetricTooltips.avgPrSize}
          history={history}
          actions={<AvgPrSizeToggle mode={mode} setMode={setMode} />}
          valueOverride={valueLabel}
        />
        {ORGANIZATION_METRIC_CARD_CONFIGS.slice(6).map((config) => (
          <MetricCard
            key={config.key}
            title={config.title}
            metric={organization.metrics[config.key]}
            format={config.format}
            impact={config.impact}
            tooltip={organizationMetricTooltips[config.tooltipKey]}
            history={toCardHistory(
              organization.metricHistory[config.historyKey],
            )}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Parent / Child 이슈 지표</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PARENT_CHILD_METRIC_CARD_CONFIGS.map((config) => (
            <MetricCard
              key={config.key}
              title={config.title}
              metric={organization.metrics[config.key]}
              format={config.format}
              impact={config.impact}
              tooltip={organizationMetricTooltips[config.tooltipKey]}
              history={toCardHistory(
                organization.metricHistory[config.historyKey],
              )}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

type AvgPrSizeToggleProps = {
  mode: AvgPrSizeMetrics["mode"];
  setMode: AvgPrSizeMetrics["setMode"];
};

function AvgPrSizeToggle({ mode, setMode }: AvgPrSizeToggleProps) {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        size="sm"
        variant={mode === "additions" ? "default" : "outline"}
        aria-pressed={mode === "additions"}
        onClick={() => setMode("additions")}
      >
        추가 라인
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "net" ? "default" : "outline"}
        aria-pressed={mode === "net"}
        onClick={() => setMode("net")}
      >
        순증 라인
      </Button>
    </div>
  );
}

type TrendSectionProps = {
  issuesNetTrend: Array<{ date: string; delta: number }>;
  prNetTrend: Array<{ date: string; delta: number }>;
  reviewHeatmap: OrganizationAnalytics["trends"]["reviewHeatmap"];
};

function TrendSection({
  issuesNetTrend,
  prNetTrend,
  reviewHeatmap,
}: TrendSectionProps) {
  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}

type RepoComparisonSectionProps = {
  columns: RepoComparisonColumn[];
  rows: RepoComparisonRow[];
  repoSort: {
    key: RepoSortKey;
    direction: RepoSortDirection;
  };
  onToggleSort: (key: RepoSortKey) => void;
};

function RepoComparisonSection({
  columns,
  rows,
  repoSort,
  onToggleSort,
}: RepoComparisonSectionProps) {
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
      return <ArrowUpDown className="h-3.5 w-3.5" />;
    }

    return repoSort.direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" />
    );
  };

  return (
    <section className="grid gap-4">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base font-medium">
            리포지토리 비교
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            리포지토리별 이슈 생성·해결, PR 생성·머지, 리뷰·댓글, 첫 리뷰까지의
            평균 시간을 비교합니다. Dependabot이 생성한 Pull Request는
            제외됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-3" scope="col">
                  리포지토리
                </th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn("pb-3 px-3 text-right", column.className)}
                    aria-sort={getRepoSortAria(column.key)}
                    scope="col"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleSort(column.key)}
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
              {rows.map((row) => (
                <tr key={row.repositoryId} className="h-12">
                  <td className="pr-4">
                    {row.repository?.nameWithOwner ?? row.repositoryId}
                  </td>
                  {columns.map((column) => (
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
  );
}

type IndividualSectionProps = {
  individual: IndividualAnalytics;
};

function IndividualSection({ individual }: IndividualSectionProps) {
  return (
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
  );
}

type LeaderboardsSectionProps = {
  analytics: DashboardAnalytics;
  reviewerEntries: LeaderboardEntry[];
  activeReviewerEntries: LeaderboardEntry[];
  mainBranchContributionEntries: LeaderboardEntry[];
  activeMainBranchContributionEntries: LeaderboardEntry[];
  mainBranchSortKey: MainBranchSortKey;
  setMainBranchSortKey: Dispatch<SetStateAction<MainBranchSortKey>>;
  activeMainBranchSortKey: MainBranchSortKey;
  setActiveMainBranchSortKey: Dispatch<SetStateAction<MainBranchSortKey>>;
  prMergedEntries: LeaderboardEntry[];
  prMergedSortKey: MainBranchSortKey;
  setPrMergedSortKey: Dispatch<SetStateAction<MainBranchSortKey>>;
};

function LeaderboardsSection({
  analytics,
  reviewerEntries,
  activeReviewerEntries,
  mainBranchContributionEntries,
  activeMainBranchContributionEntries,
  mainBranchSortKey,
  setMainBranchSortKey,
  activeMainBranchSortKey,
  setActiveMainBranchSortKey,
  prMergedEntries,
  prMergedSortKey,
  setPrMergedSortKey,
}: LeaderboardsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">리더보드</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderboardTable
          title="적극 리뷰어 활동"
          entries={activeReviewerEntries}
          valueFormatter={(value) => `${formatNumber(value)}건`}
          unit="건"
          tooltip="APPROVED 상태로 제출된 리뷰만 집계합니다."
        />
        <LeaderboardTable
          title="리뷰어 활동"
          entries={reviewerEntries}
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
          headerActions={
            <SortToggleGroup
              value={activeMainBranchSortKey}
              onChange={setActiveMainBranchSortKey}
              options={MAIN_BRANCH_SORT_OPTIONS}
            />
          }
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
          headerActions={
            <SortToggleGroup
              value={mainBranchSortKey}
              onChange={setMainBranchSortKey}
              options={MAIN_BRANCH_SORT_OPTIONS}
            />
          }
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
          headerActions={
            <SortToggleGroup
              value={prMergedSortKey}
              onChange={setPrMergedSortKey}
              options={MAIN_BRANCH_SORT_OPTIONS}
            />
          }
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
  );
}
