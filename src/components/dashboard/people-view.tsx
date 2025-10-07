"use client";

import { useEffect, useMemo } from "react";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { DashboardFilterPanel } from "@/components/dashboard/dashboard-filter-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import { individualMetricTooltips } from "@/components/dashboard/metric-tooltips";
import {
  formatMetricValue,
  type MetricFormat,
} from "@/components/dashboard/metric-utils";
import { RepoActivityTable } from "@/components/dashboard/repo-activity-table";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DashboardAnalytics,
  IndividualMetricSet,
} from "@/lib/dashboard/types";

type PeopleViewProps = {
  initialAnalytics: DashboardAnalytics;
  defaultRange: { start: string; end: string };
};

const summaryMetricConfigs = [
  { key: "issuesCreated", label: "이슈 생성", format: "count" },
  { key: "issuesClosed", label: "이슈 종료", format: "count" },
  {
    key: "issueResolutionTime",
    label: "평균 해결 시간",
    format: "hours",
  },
  { key: "issueWorkTime", label: "평균 작업 시간", format: "hours" },
  {
    key: "parentIssueResolutionTime",
    label: "Parent 해결 시간",
    format: "hours",
  },
  {
    key: "parentIssueWorkTime",
    label: "Parent 작업 시간",
    format: "hours",
  },
  {
    key: "childIssueResolutionTime",
    label: "Child 해결 시간",
    format: "hours",
  },
  {
    key: "childIssueWorkTime",
    label: "Child 작업 시간",
    format: "hours",
  },
  { key: "prsCreated", label: "PR 생성", format: "count" },
  { key: "prsMerged", label: "PR 머지", format: "count" },
  { key: "prsMergedBy", label: "PR 머지 수행", format: "count" },
  {
    key: "prCompleteness",
    label: "PR 완성도",
    format: "ratio",
  },
  { key: "reviewsCompleted", label: "리뷰 수행", format: "count" },
  {
    key: "activeReviewsCompleted",
    label: "적극 리뷰 수행",
    format: "count",
  },
  {
    key: "reviewResponseTime",
    label: "리뷰 응답 시간",
    format: "hours",
  },
  { key: "prsReviewed", label: "PR 리뷰", format: "count" },
  { key: "reviewComments", label: "리뷰 댓글", format: "count" },
  {
    key: "reviewCoverage",
    label: "PR 리뷰 커버리지",
    format: "percentage",
  },
  {
    key: "reviewParticipation",
    label: "리뷰 참여 비율",
    format: "percentage",
  },
  {
    key: "discussionComments",
    label: "코멘트 참여",
    format: "count",
  },
] satisfies ReadonlyArray<{
  key: keyof IndividualMetricSet;
  label: string;
  format: MetricFormat;
}>;

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

    const priorityOf = (person: (typeof unsortedContributors)[number]) => {
      const identifier = (person.login ?? person.name ?? person.id)
        .toLowerCase()
        .replace(/^@/, "");
      if (identifier === "octoaide") {
        return 0;
      }
      if (identifier === "codecov") {
        return 1;
      }
      if (
        identifier === "dependabot" ||
        identifier === "app/dependabot" ||
        identifier.startsWith("dependabot")
      ) {
        return 2;
      }
      return 3;
    };

    return [...unsortedContributors].sort((first, second) => {
      const priorityDiff = priorityOf(first) - priorityOf(second);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return displayName(first).localeCompare(displayName(second), undefined, {
        sensitivity: "base",
      });
    });
  }, [unsortedContributors]);
  const individual = analytics.individual;
  const individualHistory = individual?.metricHistory;
  const reviewHeatmapData = individual?.trends.reviewHeatmap ?? [];
  const activityHeatmapData = individual?.trends.activityHeatmap ?? [];
  const hasReviewHeatmap = reviewHeatmapData.some((cell) => cell.count > 0);
  const hasActivityHeatmap = activityHeatmapData.some((cell) => cell.count > 0);

  const summaryItems = useMemo(() => {
    if (!individual) {
      return [];
    }

    return summaryMetricConfigs.map(({ key, label, format }) => ({
      label,
      value: formatMetricValue(individual.metrics[key], format),
    }));
  }, [individual]);

  const personLabel = useMemo(() => {
    if (!individual) {
      return "";
    }

    return (
      individual.person.login ?? individual.person.name ?? individual.person.id
    );
  }, [individual]);

  const initialContributorId = useMemo(() => {
    if (filters.personId) {
      return null;
    }

    const normalize = (value: string | null | undefined) =>
      (value ?? "").toLowerCase().replace(/^@/, "");

    const octoaideFromContributors = contributors.find(
      (person) =>
        normalize(person.login ?? person.name ?? person.id) === "octoaide",
    );

    const octoaideFromActive = (analytics.activeContributors ?? []).find(
      (person) =>
        normalize(person.login ?? person.name ?? person.id) === "octoaide",
    );

    return octoaideFromContributors?.id ?? octoaideFromActive?.id ?? "octoaide";
  }, [analytics.activeContributors, contributors, filters.personId]);

  useEffect(() => {
    if (!filters.personId && initialContributorId) {
      const nextFilters = { ...filters, personId: initialContributorId };
      void applyFilters(nextFilters);
    }
  }, [filters, filters.personId, initialContributorId, applyFilters]);

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
                활동 요약 · {personLabel}
              </CardTitle>
              {individual.person.name && individual.person.login && (
                <CardDescription className="text-sm text-muted-foreground">
                  {individual.person.name}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                {summaryItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 p-3"
                  >
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="text-base font-semibold text-foreground">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
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
              title="PR 완성도"
              metric={individual.metrics.prCompleteness}
              format="ratio"
              impact="negative"
              tooltip={individualMetricTooltips.prCompleteness}
              history={toCardHistory(individualHistory?.prCompleteness)}
            />
            <MetricCard
              title="리뷰 수행"
              metric={individual.metrics.reviewsCompleted}
              format="count"
              tooltip={individualMetricTooltips.reviewsCompleted}
              history={toCardHistory(individualHistory?.reviewsCompleted)}
            />
            <MetricCard
              title="적극 리뷰 수행"
              metric={individual.metrics.activeReviewsCompleted}
              format="count"
              tooltip={individualMetricTooltips.activeReviewsCompleted}
              history={toCardHistory(individualHistory?.activeReviewsCompleted)}
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
              title="코멘트 참여"
              metric={individual.metrics.discussionComments}
              format="count"
              tooltip={individualMetricTooltips.discussionComments}
              history={toCardHistory(individualHistory?.discussionComments)}
            />
          </section>

          <section className="flex flex-col gap-4">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base font-medium">
                  리뷰 활동 히트맵
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  요일·시간대별 리뷰 집중도
                </CardDescription>
              </CardHeader>
              <CardContent>
                {hasReviewHeatmap ? (
                  <ActivityHeatmap data={reviewHeatmapData} valueLabel="리뷰" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    선택한 기간에는 리뷰 활동이 없습니다.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base font-medium">
                  전체 활동 히트맵
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  이슈 생성, 리뷰, PR 생성·머지, 코멘트 등 모든 활동
                </CardDescription>
              </CardHeader>
              <CardContent>
                {hasActivityHeatmap ? (
                  <ActivityHeatmap
                    data={activityHeatmapData}
                    valueLabel="활동"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    선택한 기간에는 활동 데이터가 없습니다.
                  </p>
                )}
              </CardContent>
            </Card>
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

          <section className="grid gap-4">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="text-base font-medium">
                  활동 리포지토리
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  해당 기간 동안 활동한 모든 리포지토리의 세부 지표
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RepoActivityTable items={individual.repoComparison} />
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
