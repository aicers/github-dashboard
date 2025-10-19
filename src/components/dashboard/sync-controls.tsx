"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";

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
import {
  formatDateTime as formatDateTimeDisplay,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import type { BackfillResult, SyncStatus } from "@/lib/sync/service";

type SyncControlsProps = {
  status: SyncStatus;
  isAdmin: boolean;
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
};

async function parseApiResponse<T>(
  response: Response,
): Promise<ApiResponse<T>> {
  const rawBody = await response.text();
  const body = rawBody.trim();

  if (!body) {
    const statusLabel = response.statusText
      ? `${response.status} ${response.statusText}`
      : `${response.status}`;
    throw new Error(`서버에서 빈 응답이 반환되었습니다. (${statusLabel})`);
  }

  try {
    return JSON.parse(body) as ApiResponse<T>;
  } catch (error) {
    const statusLabel = response.statusText
      ? `${response.status} ${response.statusText}`
      : `${response.status}`;
    const preview = body.replace(/\s+/g, " ").slice(0, 120);
    console.error("Unexpected non-JSON response", {
      status: response.status,
      statusText: response.statusText,
      preview,
      error,
    });
    throw new Error(`서버 응답을 해석하지 못했습니다. (${statusLabel})`);
  }
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const statusColors: Record<string, string> = {
  success: "text-emerald-600",
  failed: "text-red-600",
  running: "text-amber-600",
};

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 실행할 수 있습니다.";

function toIsoString(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function SyncControls({ status, isAdmin }: SyncControlsProps) {
  const router = useRouter();
  const config = status.config;
  const timeZone =
    typeof config?.timezone === "string" && config.timezone.trim().length
      ? config.timezone
      : null;
  const dateTimeFormat = useMemo(
    () =>
      normalizeDateTimeDisplayFormat(
        typeof config?.date_time_format === "string"
          ? config.date_time_format
          : null,
      ),
    [config?.date_time_format],
  );
  const backfillInputId = useId();
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

  const [isRunningBackfill, startBackfill] = useTransition();
  const [isTogglingAuto, startToggleAuto] = useTransition();
  const [isResetting, startReset] = useTransition();

  const canManageSync = isAdmin;

  useEffect(() => {
    setAutoEnabled(config?.auto_sync_enabled ?? false);
  }, [config?.auto_sync_enabled]);

  const formatDateTime = useMemo(() => {
    return (value?: string | null) =>
      formatDateTimeDisplay(value, timeZone ?? undefined, dateTimeFormat);
  }, [dateTimeFormat, timeZone]);

  function formatRange(startIso: string | null, endIso: string | null) {
    const start = formatDateTime(startIso);
    const end = formatDateTime(endIso);

    if (start && end) {
      return `${start} → ${end}`;
    }

    if (start) {
      return `${start} → -`;
    }

    if (end) {
      return `- → ${end}`;
    }

    return "-";
  }

  const lastSuccessfulSyncStartedAt = useMemo(() => {
    const successIso = toIsoString(config?.last_successful_sync_at ?? null);
    if (!successIso) {
      return null;
    }

    const completedIso = toIsoString(config?.last_sync_completed_at ?? null);
    const startedIso = toIsoString(config?.last_sync_started_at ?? null);

    if (completedIso && startedIso && completedIso === successIso) {
      return startedIso;
    }

    return null;
  }, [
    config?.last_successful_sync_at,
    config?.last_sync_completed_at,
    config?.last_sync_started_at,
  ]);

  async function handleBackfill() {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

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
        const data = await parseApiResponse<BackfillResult>(response);

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
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    startToggleAuto(async () => {
      try {
        const intervalValue = Number(config?.sync_interval_minutes ?? 60);
        if (!Number.isFinite(intervalValue) || intervalValue <= 0) {
          throw new Error("유효한 동기화 간격을 설정에서 먼저 지정하세요.");
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
        const data = await parseApiResponse<unknown>(response);

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
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

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
        const data = await parseApiResponse<unknown>(response);

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
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="sr-only">데이터 동기화 제어</h2>
        <p className="text-sm text-muted-foreground">
          조직({config?.org_name})의 GitHub 데이터 수집과 동기화를 관리합니다.
        </p>
        {!canManageSync ? (
          <p className="text-sm text-muted-foreground">{ADMIN_ONLY_MESSAGE}</p>
        ) : null}
        {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
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
            <Button
              onClick={handleBackfill}
              disabled={isRunningBackfill || !canManageSync}
              title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
            >
              {isRunningBackfill ? "백필 실행 중..." : "백필 실행"}
            </Button>
          </CardFooter>
        </Card>

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
            <p>
              최근 동기화:{" "}
              <span>
                {formatRange(
                  config?.last_sync_started_at ?? null,
                  config?.last_sync_completed_at ?? null,
                )}
              </span>
            </p>
            <p>
              마지막 성공:{" "}
              <span>
                {formatRange(
                  lastSuccessfulSyncStartedAt,
                  config?.last_successful_sync_at ?? null,
                )}
              </span>
            </p>
            <p>
              간격: {(config?.sync_interval_minutes ?? 60).toLocaleString()}분
            </p>
          </CardContent>
          <CardFooter className="gap-3">
            <Button
              variant={autoEnabled ? "secondary" : "default"}
              onClick={() => handleAutoToggle(!autoEnabled)}
              disabled={isTogglingAuto || !canManageSync}
              title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
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
              disabled={isResetting || !canManageSync}
              title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
            >
              {isResetting ? "삭제 중..." : "모든 데이터 삭제"}
            </Button>
          </CardFooter>
        </Card>
      </div>

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
                  <span>토론 {report.totals.discussions.toLocaleString()}</span>
                  <span>PR {report.totals.pullRequests.toLocaleString()}</span>
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
                          이슈 {chunk.summary.counts.issues.toLocaleString()} /
                          토론{" "}
                          {chunk.summary.counts.discussions.toLocaleString()} /
                          PR{" "}
                          {chunk.summary.counts.pullRequests.toLocaleString()} /
                          리뷰 {chunk.summary.counts.reviews.toLocaleString()} /
                          댓글 {chunk.summary.counts.comments.toLocaleString()}
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

      <Card className="mt-4 border-border/70">
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
  );
}
