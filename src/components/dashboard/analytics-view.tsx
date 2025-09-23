"use client";

import { Fragment } from "react";
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
  OrganizationAnalytics,
} from "@/lib/dashboard/types";

type AnalyticsViewProps = {
  initialAnalytics: DashboardAnalytics;
  defaultRange: { start: string; end: string };
  orgName?: string | null;
};

type TrendEntry = Record<string, number> & { date: string };

function mergeTrends(
  left: { date: string; value: number }[],
  right: { date: string; value: number }[],
  leftKey: string,
  rightKey: string,
) {
  const map = new Map<string, TrendEntry>();

  left.forEach((point) => {
    const entry = map.get(point.date) ?? ({ date: point.date } as TrendEntry);
    entry[leftKey] = point.value;
    map.set(point.date, entry);
  });

  right.forEach((point) => {
    const entry = map.get(point.date) ?? ({ date: point.date } as TrendEntry);
    entry[rightKey] = point.value;
    map.set(point.date, entry);
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

function LeaderboardTable({
  title,
  entries,
  unit,
}: {
  title: string;
  entries: LeaderboardEntry[];
  unit?: string;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>
        )}
        {entries.slice(0, 10).map((entry, index) => (
          <div key={entry.user.id} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-muted-foreground">{index + 1}</span>
            <div className="flex flex-col flex-1">
              <span className="font-medium">
                {entry.user.login ?? entry.user.name ?? entry.user.id}
              </span>
              {entry.user.name && entry.user.login && (
                <span className="text-xs text-muted-foreground">
                  {entry.user.name}
                </span>
              )}
            </div>
            <span className="font-semibold">
              {formatNumber(entry.value)}
              {unit}
            </span>
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
  } = useDashboardAnalytics({ initialAnalytics, defaultRange });

  const repositories = analytics.repositories;
  const contributors = analytics.contributors;

  const organization = analytics.organization as OrganizationAnalytics;

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
        />
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          title="이슈 생성"
          metric={organization.metrics.issuesCreated}
          format="count"
          impact="positive"
        />
        <MetricCard
          title="이슈 종료"
          metric={organization.metrics.issuesClosed}
          format="count"
          impact="positive"
        />
        <MetricCard
          title="평균 해결 시간"
          metric={organization.metrics.issueResolutionTime}
          format="hours"
          impact="negative"
        />
        <MetricCard
          title="평균 작업 시간"
          metric={organization.metrics.issueWorkTime}
          format="hours"
          impact="negative"
        />
        <MetricCard
          title="PR 생성"
          metric={organization.metrics.prsCreated}
          format="count"
          impact="positive"
        />
        <MetricCard
          title="PR 머지"
          metric={organization.metrics.prsMerged}
          format="count"
          impact="positive"
        />
        <MetricCard
          title="리뷰 참여 비율"
          metric={organization.metrics.reviewParticipation}
          format="percentage"
        />
        <MetricCard
          title="리뷰 응답 시간"
          metric={organization.metrics.reviewResponseTime}
          format="hours"
          impact="negative"
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
          />
          <MetricCard
            title="Parent 이슈 작업 시간"
            metric={organization.metrics.parentIssueWorkTime}
            format="hours"
            impact="negative"
          />
          <MetricCard
            title="Child 이슈 해결 시간"
            metric={organization.metrics.childIssueResolutionTime}
            format="hours"
            impact="negative"
          />
          <MetricCard
            title="Child 이슈 작업 시간"
            metric={organization.metrics.childIssueWorkTime}
            format="hours"
            impact="negative"
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
              비교합니다.
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
              선택한 기간 동안 활동량 비중이 높은 리포지토리 순위
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RepoDistributionList
              items={organization.repoDistribution.slice(0, 8)}
            />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              리뷰어 활동 Top 10
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              리뷰 건수와 참여한 PR 수를 기준으로 한 순위
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {organization.reviewers.length === 0 && (
              <p className="text-muted-foreground">데이터가 없습니다.</p>
            )}
            {organization.reviewers.map((reviewer) => (
              <div
                key={reviewer.reviewerId}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {reviewer.profile?.login ??
                      reviewer.profile?.name ??
                      reviewer.reviewerId}
                  </span>
                  {reviewer.profile?.name && reviewer.profile?.login && (
                    <span className="text-xs text-muted-foreground">
                      {reviewer.profile.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>리뷰 {formatNumber(reviewer.reviewCount)}</span>
                  <span>PR {formatNumber(reviewer.pullRequestsReviewed)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              협업 품질 지표
            </CardTitle>
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
            title="이슈 생성"
            entries={analytics.leaderboard.issuesCreated}
          />
          <LeaderboardTable
            title="리뷰 수행"
            entries={analytics.leaderboard.reviewsCompleted}
          />
          <LeaderboardTable
            title="빠른 리뷰 응답"
            entries={analytics.leaderboard.fastestResponders}
            unit="h"
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
