"use client";

import { useEffect, useMemo } from "react";
import { DashboardFilterPanel } from "@/components/dashboard/dashboard-filter-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import { individualMetricTooltips } from "@/components/dashboard/metric-tooltips";
import { formatNumber } from "@/components/dashboard/metric-utils";
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
import type { DashboardAnalytics } from "@/lib/dashboard/types";

type PeopleViewProps = {
  initialAnalytics: DashboardAnalytics;
  defaultRange: { start: string; end: string };
};

export function PeopleView({
  initialAnalytics,
  defaultRange,
}: PeopleViewProps) {
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
  const unsortedContributors = analytics.contributors;
  const contributors = useMemo(() => {
    const displayName = (person: (typeof unsortedContributors)[number]) =>
      person.login ?? person.name ?? person.id;

    return [...unsortedContributors].sort((first, second) =>
      displayName(first).localeCompare(displayName(second), undefined, {
        sensitivity: "base",
      }),
    );
  }, [unsortedContributors]);
  const individual = analytics.individual;
  const individualHistory = individual?.metricHistory;

  useEffect(() => {
    if (!filters.personId && contributors.length > 0) {
      const nextFilters = { ...filters, personId: contributors[0].id };
      void applyFilters(nextFilters);
    }
  }, [contributors, filters, filters.personId, applyFilters]);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">개인 활동 분석</h1>
            <p className="text-sm text-muted-foreground">
              팀 구성원의 이슈 처리와 리뷰 활동을 자세히 살펴보세요.
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

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">구성원 선택</h2>
        <div className="flex flex-wrap gap-2">
          {contributors.map((person) => {
            const isActive = person.id === filters.personId;
            return (
              <Button
                key={person.id}
                size="sm"
                variant={isActive ? "default" : "outline"}
                onClick={() => {
                  const nextFilters = { ...filters, personId: person.id };
                  void applyFilters(nextFilters);
                }}
              >
                {person.login ?? person.name ?? person.id}
              </Button>
            );
          })}
          {contributors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              데이터가 아직 없습니다. 동기화를 실행하여 활동을 수집하세요.
            </p>
          )}
        </div>
      </section>

      {individual ? (
        <section className="flex flex-col gap-8">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {individual.person.login ??
                  individual.person.name ??
                  individual.person.id}
              </CardTitle>
              {individual.person.name && individual.person.login && (
                <CardDescription className="text-sm text-muted-foreground">
                  {individual.person.name}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-wrap gap-6 text-sm text-muted-foreground">
              <span>
                이슈 생성{" "}
                {formatNumber(individual.metrics.issuesCreated.current)}
              </span>
              <span>
                이슈 종료{" "}
                {formatNumber(individual.metrics.issuesClosed.current)}
              </span>
              <span>
                리뷰 수행{" "}
                {formatNumber(individual.metrics.reviewsCompleted.current)}
              </span>
              <span>
                논의 댓글{" "}
                {formatNumber(individual.metrics.discussionComments.current)}
              </span>
            </CardContent>
          </Card>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              title="이슈 생성"
              metric={individual.metrics.issuesCreated}
              format="count"
              tooltip={individualMetricTooltips.issuesCreated}
              history={toCardHistory(individualHistory?.issuesCreated)}
            />
            <MetricCard
              title="이슈 종료"
              metric={individual.metrics.issuesClosed}
              format="count"
              tooltip={individualMetricTooltips.issuesClosed}
              history={toCardHistory(individualHistory?.issuesClosed)}
            />
            <MetricCard
              title="본인 이슈 해결율"
              metric={individual.metrics.issueResolutionRatio}
              format="ratio"
              tooltip={individualMetricTooltips.issueResolutionRatio}
              history={toCardHistory(individualHistory?.issueResolutionRatio)}
            />
            <MetricCard
              title="평균 해결 시간"
              metric={individual.metrics.issueResolutionTime}
              format="hours"
              impact="negative"
              tooltip={individualMetricTooltips.issueResolutionTime}
              history={toCardHistory(individualHistory?.issueResolutionTime)}
            />
            <MetricCard
              title="평균 작업 시간"
              metric={individual.metrics.issueWorkTime}
              format="hours"
              impact="negative"
              tooltip={individualMetricTooltips.issueWorkTime}
              history={toCardHistory(individualHistory?.issueWorkTime)}
            />
            <MetricCard
              title="PR 생성"
              metric={individual.metrics.prsCreated}
              format="count"
              tooltip={individualMetricTooltips.prsCreated}
              history={toCardHistory(individualHistory?.prsCreated)}
            />
            <MetricCard
              title="PR 머지"
              metric={individual.metrics.prsMerged}
              format="count"
              tooltip={individualMetricTooltips.prsMerged}
              history={toCardHistory(individualHistory?.prsMerged)}
            />
            <MetricCard
              title="PR 머지 수행"
              metric={individual.metrics.prsMergedBy}
              format="count"
              tooltip={individualMetricTooltips.prsMergedBy}
              history={toCardHistory(individualHistory?.prsMergedBy)}
            />
            <MetricCard
              title="리뷰 수행"
              metric={individual.metrics.reviewsCompleted}
              format="count"
              tooltip={individualMetricTooltips.reviewsCompleted}
              history={toCardHistory(individualHistory?.reviewsCompleted)}
            />
            <MetricCard
              title="리뷰 응답 시간"
              metric={individual.metrics.reviewResponseTime}
              format="hours"
              impact="negative"
              tooltip={individualMetricTooltips.reviewResponseTime}
              history={toCardHistory(individualHistory?.reviewResponseTime)}
            />
            <MetricCard
              title="PR 리뷰 커버리지"
              metric={individual.metrics.reviewCoverage}
              format="percentage"
              tooltip={individualMetricTooltips.reviewCoverage}
              history={toCardHistory(individualHistory?.reviewCoverage)}
            />
            <MetricCard
              title="리뷰 참여 비율"
              metric={individual.metrics.reviewParticipation}
              format="percentage"
              tooltip={individualMetricTooltips.reviewParticipation}
              history={toCardHistory(individualHistory?.reviewParticipation)}
            />
            <MetricCard
              title="토론 참여"
              metric={individual.metrics.discussionComments}
              format="count"
              tooltip={individualMetricTooltips.discussionComments}
              history={toCardHistory(individualHistory?.discussionComments)}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">Parent / Child 이슈 지표</h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Parent 이슈 해결 시간"
                metric={individual.metrics.parentIssueResolutionTime}
                format="hours"
                impact="negative"
                tooltip={individualMetricTooltips.parentIssueResolutionTime}
                history={toCardHistory(
                  individualHistory?.parentIssueResolutionTime,
                )}
              />
              <MetricCard
                title="Parent 이슈 작업 시간"
                metric={individual.metrics.parentIssueWorkTime}
                format="hours"
                impact="negative"
                tooltip={individualMetricTooltips.parentIssueWorkTime}
                history={toCardHistory(individualHistory?.parentIssueWorkTime)}
              />
              <MetricCard
                title="Child 이슈 해결 시간"
                metric={individual.metrics.childIssueResolutionTime}
                format="hours"
                impact="negative"
                tooltip={individualMetricTooltips.childIssueResolutionTime}
                history={toCardHistory(
                  individualHistory?.childIssueResolutionTime,
                )}
              />
              <MetricCard
                title="Child 이슈 작업 시간"
                metric={individual.metrics.childIssueWorkTime}
                format="hours"
                impact="negative"
                tooltip={individualMetricTooltips.childIssueWorkTime}
                history={toCardHistory(individualHistory?.childIssueWorkTime)}
              />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base font-medium">
                  활동 리포지토리
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  해당 기간 동안 활동 비중이 높은 리포지토리
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RepoDistributionList
                  items={individual.trends.repoActivity}
                  limit={8}
                />
              </CardContent>
            </Card>
          </section>
        </section>
      ) : (
        <Card className="border-border/70">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            구성원을 선택하면 주요 지표가 표시됩니다.
          </CardContent>
        </Card>
      )}
    </section>
  );
}
