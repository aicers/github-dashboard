"use client";

import { Info } from "lucide-react";
import { Fragment, useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardFilterPanel } from "@/components/dashboard/dashboard-filter-panel";
import { buildRangeFromPreset } from "@/components/dashboard/dashboard-filters";
import { MetricCard } from "@/components/dashboard/metric-card";
import { organizationMetricTooltips } from "@/components/dashboard/metric-tooltips";
import {
  formatDuration,
  formatNumber,
} from "@/components/dashboard/metric-utils";
import { RepoDistributionList } from "@/components/dashboard/repo-distribution-list";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DashboardAnalytics,
  HeatmapCell,
  LeaderboardEntry,
  MetricHistoryEntry,
  OrganizationAnalytics,
  PeriodKey,
} from "@/lib/dashboard/types";

type AnalyticsViewProps = {
  initialAnalytics: DashboardAnalytics;
  defaultRange: { start: string; end: string };
  orgName?: string | null;
};

type TrendEntry = Record<string, number> & { date: string };

const HISTORY_KEYS: PeriodKey[] = [
  "previous4",
  "previous3",
  "previous2",
  "previous",
  "current",
];
const HISTORY_LABELS: Record<PeriodKey, string> = {
  previous4: "4회 전",
  previous3: "3회 전",
  previous2: "2회 전",
  previous: "이전",
  current: "이번",
};

function mergeTrends(
  left: { date: string; value: number }[],
  right: { date: string; value: number }[],
  leftKey: string,
  rightKey: string,
) {
  const map = new Map<string, TrendEntry>();

  const ensureEntry = (date: string): TrendEntry => {
    let entry = map.get(date);
    if (!entry) {
      entry = { date, [leftKey]: 0, [rightKey]: 0 } as TrendEntry;
      map.set(date, entry);
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

function toCardHistory(series?: MetricHistoryEntry[]) {
  return HISTORY_KEYS.map((period) => ({
    period,
    label: HISTORY_LABELS[period],
    value: series?.find((entry) => entry.period === period)?.value ?? null,
  }));
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

function LeaderboardTable({
  title,
  entries,
  unit,
  valueFormatter,
  secondaryLabel,
  tooltip,
}: {
  title: string;
  entries: LeaderboardEntry[];
  unit?: string;
  valueFormatter?: (value: number) => string;
  secondaryLabel?: string;
  tooltip?: string;
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

  const mainBranchContributionEntries =
    analytics.leaderboard.mainBranchContribution;

  const issuesLineData = mergeTrends(
    organization.trends.issuesCreated,
    organization.trends.issuesClosed,
    "created",
    "closed",
  );

  const prLineData = mergeTrends(
    organization.trends.prsCreated,
    organization.trends.prsMerged,
    "created",
    "merged",
  );

  const resolutionTrend = organization.trends.issueResolutionHours.map(
    (point) => ({
      date: point.date,
      resolutionHours: Number.isFinite(point.values.resolutionHours)
        ? point.values.resolutionHours
        : 0,
      workHours: Number.isFinite(point.values.workHours)
        ? point.values.workHours
        : 0,
    }),
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
              이슈 생성 vs 종료 추이
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              선택한 기간 동안의 일별 이슈 생성 및 종료 흐름
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={issuesLineData}>
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
                  dataKey="created"
                  name="생성"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="closed"
                  name="종료"
                  stroke="#16a34a"
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
              PR 생성 vs 머지 추이
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              기간 중 PR 생성 및 머지 흐름을 비교합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={prLineData}>
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
                  dataKey="created"
                  name="생성"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="merged"
                  name="머지"
                  stroke="#ea580c"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              월별 평균 해결 · 작업 시간
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              해결 시점과 작업 완료 시점까지 걸린 시간을 월별로 비교합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resolutionTrend}>
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
                <Bar
                  dataKey="resolutionHours"
                  name="평균 해결 시간"
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="workHours"
                  name="평균 작업 시간"
                  fill="#16a34a"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

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

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              리포지토리 비교
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              리포지토리별 해결 이슈, 머지 PR, 첫 리뷰까지의 평균 시간을
              비교합니다. Dependabot이 생성한 Pull Request는 제외됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-3">리포지토리</th>
                  <th className="pb-3">이슈 해결</th>
                  <th className="pb-3">PR 머지</th>
                  <th className="pb-3">평균 첫 리뷰(시간)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {organization.repoComparison.map((row) => (
                  <tr key={row.repositoryId} className="h-12">
                    <td className="pr-4">
                      {row.repository?.nameWithOwner ?? row.repositoryId}
                    </td>
                    <td>{formatNumber(row.issuesResolved)}</td>
                    <td>{formatNumber(row.pullRequestsMerged)}</td>
                    <td>
                      {row.avgFirstReviewHours == null
                        ? "–"
                        : formatDuration(row.avgFirstReviewHours, "hours")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              리포지토리 활동 비중
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              선택한 기간 동안 활동량 비중이 높은 리포지토리 순위입니다.
              Dependabot이 생성한 Pull Request는 제외됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RepoDistributionList
              items={organization.repoDistribution.slice(0, 8)}
            />
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
              <span>평균 PR 크기</span>
              <span className="font-medium">
                {formatNumber(organization.metrics.avgPrSize.current)} 라인
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>PR 당 평균 댓글</span>
              <span className="font-medium">
                {organization.metrics.avgCommentsPerPr.current.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>이슈 당 평균 댓글</span>
              <span className="font-medium">
                {organization.metrics.avgCommentsPerIssue.current.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>재오픈 비율</span>
              <span className="font-medium">
                {(
                  organization.metrics.reopenedIssuesRatio.current * 100
                ).toFixed(1)}
                %
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>리뷰 참여 비율</span>
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
              title="본인 이슈 해결율"
              metric={individual.metrics.issueResolutionRatio}
              format="ratio"
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
            title="리뷰어 활동"
            entries={reviewerLeaderboardEntries}
            valueFormatter={(value) => `${formatNumber(value)}건`}
            secondaryLabel="참여 PR"
            unit="건"
          />
          <LeaderboardTable
            title="메인 브랜치 기여"
            entries={mainBranchContributionEntries}
            valueFormatter={(value) => `${formatNumber(value)}건`}
            secondaryLabel="리뷰"
            unit="건"
            tooltip="리뷰한 PR과 직접 생성한 PR 중에서 머지된 PR 건수를 합산합니다. +/− 값은 병합된 PR들의 코드 추가·삭제 라인 합계입니다. Dependabot Pull Request는 제외됩니다."
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
            title="토론 참여"
            entries={analytics.leaderboard.discussionEngagement}
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
