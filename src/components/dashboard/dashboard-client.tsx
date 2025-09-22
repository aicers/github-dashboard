"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  BackfillResult,
  DashboardStats,
  SyncStatus,
} from "@/lib/sync/service";

type DashboardClientProps = {
  status: SyncStatus;
  stats: DashboardStats;
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "–";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const statusColors: Record<string, string> = {
  success: "text-emerald-600",
  failed: "text-red-600",
  running: "text-amber-600",
};

export function DashboardClient({ status, stats }: DashboardClientProps) {
  const router = useRouter();
  const config = status.config;
  const orgInputId = useId();
  const intervalInputId = useId();
  const backfillInputId = useId();
  const [orgName, setOrgName] = useState(config?.org_name ?? "");
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(
    config?.sync_interval_minutes?.toString() ?? "60",
  );
  const [autoEnabled, setAutoEnabled] = useState(
    config?.auto_sync_enabled ?? false,
  );
  const [backfillDate, setBackfillDate] = useState(() => {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    return now.toISOString().slice(0, 10);
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [backfillHistory, setBackfillHistory] = useState<BackfillResult[]>([]);

  const [isUpdatingOrg, startUpdateOrg] = useTransition();
  const [isRunningBackfill, startBackfill] = useTransition();
  const [isTogglingAuto, startToggleAuto] = useTransition();
  const [isResetting, startReset] = useTransition();

  const totalCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of stats.counts) {
      counts[row.type] = row.count;
    }

    return counts;
  }, [stats.counts]);

  async function handleOrgUpdate() {
    startUpdateOrg(async () => {
      try {
        const intervalValue = Number.parseInt(syncIntervalMinutes, 10);
        if (Number.isNaN(intervalValue) || intervalValue <= 0) {
          throw new Error("유효한 동기화 주기를 입력하세요.");
        }

        const response = await fetch("/api/sync/config", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orgName,
            syncIntervalMinutes: intervalValue,
          }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (!data.success) {
          throw new Error(data.message ?? "Failed to update configuration.");
        }

        setFeedback("구성 변경이 저장되었습니다.");
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "구성 업데이트 중 오류가 발생했습니다.",
        );
      }
    });
  }

  function formatRange(startIso: string | null, endIso: string | null) {
    return `${formatDateTime(startIso)} → ${formatDateTime(endIso)}`;
  }

  async function handleBackfill() {
    startBackfill(async () => {
      try {
        if (!backfillDate) {
          throw new Error("백필 시작 날짜를 선택하세요.");
        }

        setBackfillHistory((previous) => previous);
        const response = await fetch("/api/sync/backfill", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ startDate: backfillDate }),
        });
        const data = (await response.json()) as ApiResponse<BackfillResult>;

        if (!data.success) {
          throw new Error(data.message ?? "백필 실행에 실패했습니다.");
        }

        const report = data.result ?? null;
        if (report) {
          setBackfillHistory((previous) => [report, ...previous].slice(0, 5));
          const failedChunk = report.chunks.find(
            (chunk) => chunk.status === "failed",
          );
          if (failedChunk && failedChunk.status === "failed") {
            setFeedback(
              `백필이 ${formatRange(failedChunk.since, failedChunk.until)} 구간에서 실패했습니다: ${failedChunk.error}`,
            );
          } else {
            setFeedback("백필이 성공적으로 실행되었습니다.");
          }
        } else {
          setFeedback("백필이 성공적으로 실행되었습니다.");
        }
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "백필 중 오류가 발생했습니다.",
        );
      }
    });
  }

  async function handleAutoToggle(nextEnabled: boolean) {
    startToggleAuto(async () => {
      try {
        const intervalValue = Number.parseInt(syncIntervalMinutes, 10);
        if (Number.isNaN(intervalValue) || intervalValue <= 0) {
          throw new Error("유효한 동기화 주기를 입력하세요.");
        }

        const response = await fetch("/api/sync/auto", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enabled: nextEnabled,
            intervalMinutes: intervalValue,
          }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (!data.success) {
          throw new Error(data.message ?? "자동 동기화 설정에 실패했습니다.");
        }

        setAutoEnabled(nextEnabled);
        setFeedback(
          nextEnabled
            ? "자동 동기화를 실행했습니다."
            : "자동 동기화를 중단했습니다.",
        );
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "자동 동기화 설정 중 오류가 발생했습니다.",
        );
      }
    });
  }

  async function handleReset() {
    if (!window.confirm("정말로 모든 데이터를 삭제하시겠습니까?")) {
      return;
    }

    startReset(async () => {
      try {
        const response = await fetch("/api/sync/reset", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ preserveLogs: true }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (!data.success) {
          throw new Error(data.message ?? "데이터 초기화에 실패했습니다.");
        }

        setFeedback("데이터가 초기화되었습니다.");
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "데이터 초기화 중 오류가 발생했습니다.",
        );
      }
    });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">GitHub 데이터 수집 대시보드</h1>
        <p className="text-sm text-muted-foreground">
          조직({orgName || config?.org_name})의 활동 데이터를 수집하고 동기화
          상태를 관리합니다.
        </p>
        {feedback && <p className="text-sm text-primary">{feedback}</p>}
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Organization 설정</CardTitle>
            <CardDescription>
              대상 GitHub Organization 이름과 동기화 주기를 변경합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm" htmlFor={orgInputId}>
              <span className="text-muted-foreground">Organization 이름</span>
              <Input
                id={orgInputId}
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                placeholder="my-organization"
              />
            </label>
            <label
              className="flex flex-col gap-2 text-sm"
              htmlFor={intervalInputId}
            >
              <span className="text-muted-foreground">
                자동 동기화 주기 (분)
              </span>
              <Input
                id={intervalInputId}
                value={syncIntervalMinutes}
                onChange={(event) => setSyncIntervalMinutes(event.target.value)}
                type="number"
                min={1}
              />
            </label>
          </CardContent>
          <CardFooter>
            <Button onClick={handleOrgUpdate} disabled={isUpdatingOrg}>
              {isUpdatingOrg ? "저장 중..." : "변경사항 저장"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>수동 데이터 백필</CardTitle>
            <CardDescription>
              선택한 날짜부터 최신 데이터까지 즉시 수집합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label
              className="flex flex-col gap-2 text-sm"
              htmlFor={backfillInputId}
            >
              <span className="text-muted-foreground">시작 날짜</span>
              <Input
                id={backfillInputId}
                value={backfillDate}
                onChange={(event) => setBackfillDate(event.target.value)}
                type="date"
              />
            </label>
          </CardContent>
          <CardFooter>
            <Button onClick={handleBackfill} disabled={isRunningBackfill}>
              {isRunningBackfill ? "백필 실행 중..." : "백필 실행"}
            </Button>
          </CardFooter>
        </Card>

        {backfillHistory.length > 0 && (
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>백필 결과 히스토리</CardTitle>
              <CardDescription>
                최근 실행 최대 5회까지의 누적 결과를 확인할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              {backfillHistory.map((report, index) => (
                <div
                  key={`history-${report.startDate}-${report.endDate}-${index}`}
                  className="space-y-3 border-b border-border/40 pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap gap-4 text-muted-foreground">
                    <span className="font-medium text-foreground">
                      실행 #{backfillHistory.length - index} •{" "}
                      {formatRange(report.startDate, report.endDate)}
                    </span>
                    <span>일수 {report.chunkCount}</span>
                    <span>이슈 {report.totals.issues.toLocaleString()}</span>
                    <span>
                      PR {report.totals.pullRequests.toLocaleString()}
                    </span>
                    <span>리뷰 {report.totals.reviews.toLocaleString()}</span>
                    <span>댓글 {report.totals.comments.toLocaleString()}</span>
                  </div>

                  <ul className="space-y-2">
                    {report.chunks.map((chunk) =>
                      chunk.status === "success" ? (
                        <li
                          key={`success-${chunk.since}-${chunk.until}`}
                          className="flex flex-col gap-1 rounded-md border border-border/50 bg-background/80 px-4 py-3"
                        >
                          <span className="font-medium text-emerald-500">
                            ✅ {formatRange(chunk.since, chunk.until)}
                          </span>
                          <span className="text-muted-foreground">
                            이슈 {chunk.summary.counts.issues.toLocaleString()}{" "}
                            / PR{" "}
                            {chunk.summary.counts.pullRequests.toLocaleString()}{" "}
                            / 리뷰{" "}
                            {chunk.summary.counts.reviews.toLocaleString()} /
                            댓글{" "}
                            {chunk.summary.counts.comments.toLocaleString()}
                          </span>
                        </li>
                      ) : (
                        <li
                          key={`failed-${chunk.since}-${chunk.until}`}
                          className="flex flex-col gap-1 rounded-md border border-destructive/60 bg-destructive/10 px-4 py-3"
                        >
                          <span className="font-medium text-destructive">
                            ⚠️ {formatRange(chunk.since, chunk.until)} 구간 실패
                          </span>
                          <span>{chunk.error}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>자동 동기화</CardTitle>
            <CardDescription>
              {autoEnabled
                ? "자동 동기화가 활성화되어 있습니다."
                : "필요 시 자동으로 데이터를 가져오도록 설정할 수 있습니다."}
            </CardDescription>
            <CardAction>
              <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                {autoEnabled ? "활성" : "비활성"}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>최근 동기화: {formatDateTime(config?.last_sync_completed_at)}</p>
            <p>
              마지막 성공: {formatDateTime(config?.last_successful_sync_at)}
            </p>
          </CardContent>
          <CardFooter className="gap-3">
            <Button
              variant={autoEnabled ? "secondary" : "default"}
              onClick={() => handleAutoToggle(!autoEnabled)}
              disabled={isTogglingAuto}
            >
              {isTogglingAuto
                ? "처리 중..."
                : autoEnabled
                  ? "자동 동기화 중단"
                  : "자동 동기화 시작"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>데이터 초기화</CardTitle>
            <CardDescription>
              문제 발생 시 저장된 GitHub 데이터를 모두 삭제합니다. 로그는
              유지됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>이 작업은 되돌릴 수 없습니다. 실행 전 반드시 확인하세요.</p>
          </CardContent>
          <CardFooter>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={isResetting}
            >
              {isResetting ? "삭제 중..." : "모든 데이터 삭제"}
            </Button>
          </CardFooter>
        </Card>
      </section>

      <section className="flex flex-col gap-6">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>저장 현황</CardTitle>
            <CardDescription>
              데이터 규모와 시간 범위를 한눈에 확인합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-4">
              {["issues", "pull_requests", "reviews", "comments"].map((key) => (
                <div
                  key={key}
                  className="rounded-lg border border-border/60 bg-background px-4 py-3"
                >
                  <p className="text-xs uppercase text-muted-foreground">
                    {key.replace("_", " ")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {(totalCounts[key] ?? 0).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-background px-4 py-3 text-sm">
                <p className="text-xs uppercase text-muted-foreground">
                  이슈 수집 범위
                </p>
                <p className="mt-2">
                  {formatDateTime(stats.issuesRange?.oldest)}
                </p>
                <p className="text-xs text-muted-foreground">
                  최근 업데이트: {formatDateTime(stats.issuesRange?.newest)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background px-4 py-3 text-sm">
                <p className="text-xs uppercase text-muted-foreground">
                  PR 수집 범위
                </p>
                <p className="mt-2">
                  {formatDateTime(stats.pullRequestsRange?.oldest)}
                </p>
                <p className="text-xs text-muted-foreground">
                  최근 업데이트:{" "}
                  {formatDateTime(stats.pullRequestsRange?.newest)}
                </p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">사용자별 이슈 Top 5</h3>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {stats.topUsers.length === 0 && <li>데이터가 없습니다.</li>}
                  {stats.topUsers.map((row) => {
                    const issueCount = row.issueCount;
                    const profile = row.profile;
                    const label =
                      profile?.login ?? row.authorId ?? "(알 수 없음)";

                    return (
                      <li
                        key={row.authorId ?? label}
                        className="flex justify-between gap-4"
                      >
                        <span>
                          {label}
                          {profile?.name && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {profile.name}
                            </span>
                          )}
                        </span>
                        <span>{issueCount.toLocaleString()}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold">리포지토리 활동 Top 5</h3>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {stats.topRepositories.length === 0 && (
                    <li>데이터가 없습니다.</li>
                  )}
                  {stats.topRepositories.map((row) => {
                    const issueCount = row.issueCount;
                    const prCount = row.pullRequestCount;
                    const repo = row.repository;
                    const label =
                      repo?.nameWithOwner ??
                      repo?.name ??
                      row.repositoryId ??
                      "(알 수 없음)";

                    return (
                      <li
                        key={row.repositoryId ?? label}
                        className="flex justify-between gap-4"
                      >
                        <span>{label}</span>
                        <span>
                          이슈 {issueCount.toLocaleString()} / PR{" "}
                          {prCount.toLocaleString()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>최근 동기화 로그</CardTitle>
            <CardDescription>
              각 리소스의 실행 상태와 메시지를 확인합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {status.logs.length === 0 && (
              <p className="text-muted-foreground">로그가 없습니다.</p>
            )}
            {status.logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-border/60 bg-background px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase text-muted-foreground">
                    {log.resource}
                  </span>
                  <span
                    className={`text-xs font-semibold ${statusColors[log.status] ?? ""}`}
                  >
                    {capitalize(log.status)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatDateTime(log.started_at)} →{" "}
                  {formatDateTime(log.finished_at)}
                </p>
                {log.message && <p className="mt-1 text-sm">{log.message}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
