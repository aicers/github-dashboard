"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import type { useAuthorizedFetch } from "@/components/dashboard/hooks/use-authorized-fetch";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PickerInput } from "@/components/ui/picker-input";
import type { ActivityCacheRefreshResult } from "@/lib/activity/cache";
import type { ActivitySnapshotSummary } from "@/lib/activity/snapshot";
import type {
  IssueStatusAutomationRunResult,
  IssueStatusAutomationSummary,
} from "@/lib/activity/status-automation";
import {
  type DateTimeDisplayFormat,
  formatDateTime as formatDateTimeDisplay,
} from "@/lib/date-time-format";
import type { SyncStatus } from "@/lib/sync/service";

// ---------------------------------------------------------------------------
// Private types
// ---------------------------------------------------------------------------

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
  reauthRequired?: boolean;
};

type IssueStatusAutomationPostResult = {
  run: IssueStatusAutomationRunResult;
  summary: IssueStatusAutomationSummary | null;
};

type MentionClassificationSummary = {
  status: "completed" | "skipped";
  totalCandidates: number;
  attempted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  requiresResponseCount: number;
  notRequiringResponseCount: number;
  errors: number;
  message?: string;
};

type UnansweredMentionStatusValue =
  | "running"
  | "success"
  | "failed"
  | "partial"
  | "skipped";

type MentionClassificationMode = "standard" | "force";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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

function toIsoString(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function parseFilterCounts(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const rawCounts = (metadata as { counts?: unknown }).counts;
  if (!rawCounts || typeof rawCounts !== "object") {
    return null;
  }
  const counts = rawCounts as Record<string, unknown>;
  return {
    repositories: Number(counts.repositories) || 0,
    labels: Number(counts.labels) || 0,
    users: Number(counts.users) || 0,
    issueTypes: Number(counts.issueTypes) || 0,
    milestones: Number(counts.milestones) || 0,
  };
}

function parseLinkCount(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }
  const linkCount = (metadata as { linkCount?: unknown }).linkCount;
  return typeof linkCount === "number" ? linkCount : 0;
}

const unansweredMentionStatusLabels: Record<
  UnansweredMentionStatusValue,
  string
> = {
  running: "실행 중",
  success: "성공",
  failed: "실패",
  partial: "부분 완료",
  skipped: "건너뜀",
};

function isUnansweredMentionStatusValue(
  value: unknown,
): value is UnansweredMentionStatusValue {
  return (
    typeof value === "string" &&
    (value === "running" ||
      value === "success" ||
      value === "failed" ||
      value === "partial" ||
      value === "skipped")
  );
}

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 실행할 수 있습니다.";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type SyncDataToolsPanelProps = {
  status: SyncStatus;
  canManageSync: boolean;
  timeZone: string | null;
  dateTimeFormat: DateTimeDisplayFormat;
  onFeedback: (message: string | null) => void;
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyncDataToolsPanel({
  status,
  canManageSync,
  timeZone,
  dateTimeFormat,
  onFeedback,
  authorizedFetch,
}: SyncDataToolsPanelProps) {
  const router = useRouter();
  const config = status.config;

  const statusAutomationStartId = useId();

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [activityCacheSummary, setActivityCacheSummary] =
    useState<ActivityCacheRefreshResult | null>(null);
  const [activitySnapshotSummary, setActivitySnapshotSummary] =
    useState<ActivitySnapshotSummary | null>(null);
  const [issueStatusAutomationSummary, setIssueStatusAutomationSummary] =
    useState<IssueStatusAutomationSummary | null>(null);
  const [statusAutomationStart, setStatusAutomationStart] = useState("");
  const [isRefreshingActivitySnapshot, setIsRefreshingActivitySnapshot] =
    useState(false);
  const [isRefreshingActivityCache, setIsRefreshingActivityCache] =
    useState(false);
  const [isRunningStatusAutomation, setIsRunningStatusAutomation] =
    useState(false);
  const [isClassifyingMentions, setIsClassifyingMentions] = useState(false);
  const [mentionClassificationMode, setMentionClassificationMode] =
    useState<MentionClassificationMode>("standard");

  // -------------------------------------------------------------------------
  // Derived values from activityCacheSummary
  // -------------------------------------------------------------------------

  const activityCacheFilterCounts = activityCacheSummary
    ? parseFilterCounts(activityCacheSummary.filterOptions.metadata)
    : null;
  const activityCacheIssueLinkCount = activityCacheSummary
    ? parseLinkCount(activityCacheSummary.issueLinks.metadata)
    : null;
  const activityCachePrLinkCount = activityCacheSummary
    ? parseLinkCount(activityCacheSummary.pullRequestLinks.metadata)
    : null;

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!canManageSync) {
      setActivityCacheSummary(null);
      setActivitySnapshotSummary(null);
      setIssueStatusAutomationSummary(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadSummary = async () => {
      try {
        const response = await authorizedFetch(() =>
          fetch("/api/activity/cache/refresh", {
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
          }),
        );
        if (!response.ok) {
          return;
        }

        const data =
          await parseApiResponse<ActivityCacheRefreshResult>(response);
        if (!data.success) {
          return;
        }

        const caches =
          data.result ??
          (data as unknown as { caches?: ActivityCacheRefreshResult }).caches ??
          null;
        if (!cancelled) {
          setActivityCacheSummary(caches);
        }

        try {
          const snapshotResponse = await authorizedFetch(() =>
            fetch("/api/activity/snapshot/refresh", {
              method: "GET",
              signal: controller.signal,
              cache: "no-store",
            }),
          );

          if (snapshotResponse.ok) {
            const snapshotData =
              await parseApiResponse<ActivitySnapshotSummary | null>(
                snapshotResponse,
              );
            if (snapshotData.success) {
              const snapshotSummary =
                snapshotData.result ??
                (
                  snapshotData as unknown as {
                    summary?: ActivitySnapshotSummary | null;
                  }
                ).summary ??
                null;
              if (!cancelled) {
                setActivitySnapshotSummary(snapshotSummary);
              }
            }
          }
        } catch (snapshotError) {
          if (!controller.signal.aborted) {
            console.warn(
              "[sync-data-tools-panel] Failed to load Activity snapshot summary",
              snapshotError,
            );
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(
            "[sync-data-tools-panel] Failed to load Activity cache summary",
            error,
          );
        }
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canManageSync, authorizedFetch]);

  useEffect(() => {
    if (!canManageSync) {
      setIssueStatusAutomationSummary(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadAutomationSummary = async () => {
      try {
        const response = await authorizedFetch(() =>
          fetch("/api/activity/status-automation", {
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
          }),
        );
        if (!response.ok) {
          return;
        }

        const data =
          await parseApiResponse<IssueStatusAutomationSummary | null>(response);
        if (!data.success) {
          return;
        }

        const summary =
          data.result ??
          (
            data as unknown as {
              summary?: IssueStatusAutomationSummary | null;
            }
          ).summary ??
          null;

        if (!cancelled) {
          setIssueStatusAutomationSummary(summary);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(
            "[sync-data-tools-panel] Failed to load issue status automation summary",
            error,
          );
        }
      }
    };

    void loadAutomationSummary();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canManageSync, authorizedFetch]);

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  const formatDateTime = useMemo(() => {
    return (value?: string | null) =>
      formatDateTimeDisplay(value, timeZone ?? undefined, dateTimeFormat);
  }, [dateTimeFormat, timeZone]);

  const unansweredStatusValue = isUnansweredMentionStatusValue(
    config?.unanswered_mentions_last_status,
  )
    ? config?.unanswered_mentions_last_status
    : null;
  const unansweredStatusLabel = unansweredStatusValue
    ? (unansweredMentionStatusLabels[unansweredStatusValue] ??
      unansweredStatusValue)
    : null;
  const unansweredLastStartedAtIso = toIsoString(
    config?.unanswered_mentions_last_started_at ?? null,
  );
  const unansweredLastCompletedAtIso = toIsoString(
    config?.unanswered_mentions_last_completed_at ?? null,
  );
  const unansweredLastSuccessAtIso = toIsoString(
    config?.unanswered_mentions_last_success_at ?? null,
  );
  const unansweredLastError =
    typeof config?.unanswered_mentions_last_error === "string" &&
    config.unanswered_mentions_last_error
      ? config.unanswered_mentions_last_error
      : null;

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  async function handleActivitySnapshotRefresh() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    setIsRefreshingActivitySnapshot(true);
    try {
      const response = await fetch("/api/activity/snapshot/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "sync-controls" }),
      });

      const data = await parseApiResponse<ActivitySnapshotSummary | null>(
        response,
      );
      if (!data.success) {
        throw new Error(
          data.message ?? "Activity 스냅샷 재생성에 실패했습니다.",
        );
      }

      const summary =
        data.result ??
        (data as unknown as { summary?: ActivitySnapshotSummary | null })
          .summary ??
        null;

      setActivitySnapshotSummary(summary);
      onFeedback("Activity 스냅샷을 재생성했습니다.");
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "Activity 스냅샷 재생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRefreshingActivitySnapshot(false);
    }
  }

  async function handleActivityCacheRefresh() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    setIsRefreshingActivityCache(true);
    try {
      const response = await fetch("/api/activity/cache/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "sync-controls" }),
      });
      const data = await parseApiResponse<ActivityCacheRefreshResult>(response);
      if (!data.success) {
        throw new Error(
          data.message ?? "Activity 캐시 새로고침에 실패했습니다.",
        );
      }
      const caches =
        data.result ??
        (data as unknown as { caches?: ActivityCacheRefreshResult }).caches ??
        null;

      if (caches) {
        setActivityCacheSummary(caches);
        const filterCounts = parseFilterCounts(caches.filterOptions.metadata);
        const issueLinkCount = parseLinkCount(caches.issueLinks.metadata);
        const prLinkCount = parseLinkCount(caches.pullRequestLinks.metadata);
        const filterLabel = filterCounts
          ? `필터 ${caches.filterOptions.itemCount.toLocaleString()}건 (저장소 ${filterCounts.repositories.toLocaleString()}개)`
          : `필터 ${caches.filterOptions.itemCount.toLocaleString()}건`;
        onFeedback(
          `Activity 캐시를 새로 고쳤습니다. (${filterLabel}, 이슈 링크 ${issueLinkCount.toLocaleString()}건, PR 링크 ${prLinkCount.toLocaleString()}건)`,
        );
      } else {
        onFeedback("Activity 캐시 새로고침 요청이 완료되었습니다.");
      }

      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "Activity 캐시 새로고침 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRefreshingActivityCache(false);
    }
  }

  async function handleMentionClassification(force?: boolean) {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    setMentionClassificationMode(force ? "force" : "standard");
    setIsClassifyingMentions(true);
    try {
      const requestInit: RequestInit = force
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ force: true }),
          }
        : { method: "POST" };
      const response = await fetch(
        "/api/attention/unanswered-mentions/classify",
        requestInit,
      );
      const data =
        await parseApiResponse<MentionClassificationSummary>(response);
      if (!data.success) {
        throw new Error(data.message ?? "응답 없는 멘션 분류에 실패했습니다.");
      }

      const summary = data.result ?? null;
      if (summary) {
        const detailParts = [
          `후보 ${summary.totalCandidates.toLocaleString()}건`,
          `새 평가 ${summary.updated.toLocaleString()}건`,
          `유지 ${summary.unchanged.toLocaleString()}건`,
        ];
        if (summary.skipped > 0) {
          detailParts.push(`건너뜀 ${summary.skipped.toLocaleString()}건`);
        }
        if (summary.errors > 0) {
          detailParts.push(`오류 ${summary.errors.toLocaleString()}건`);
        }
        const detail = detailParts.join(", ");
        const baseMessage =
          summary.message ?? "응답 없는 멘션 분류를 완료했습니다.";
        onFeedback(detail.length ? `${baseMessage} (${detail})` : baseMessage);
      } else {
        onFeedback("응답 없는 멘션 분류를 완료했습니다.");
      }
      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "응답 없는 멘션 분류 중 오류가 발생했습니다.",
      );
    } finally {
      setIsClassifyingMentions(false);
      setMentionClassificationMode("standard");
    }
  }

  async function handleIssueStatusAutomation() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    let overrideStartAt: string | undefined;
    if (statusAutomationStart.trim().length) {
      const parsed = new Date(statusAutomationStart);
      if (Number.isNaN(parsed.getTime())) {
        onFeedback("유효한 시작 시각을 입력하세요.");
        return;
      }
      overrideStartAt = parsed.toISOString();
    }

    setIsRunningStatusAutomation(true);
    try {
      const requestPayload: Record<string, unknown> = {
        trigger: "sync-controls",
      };
      if (overrideStartAt) {
        requestPayload.startAt = overrideStartAt;
      }

      const response = await fetch("/api/activity/status-automation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      const data =
        await parseApiResponse<IssueStatusAutomationPostResult>(response);
      if (!data.success) {
        throw new Error(data.message ?? "진행 상태 설정 실행에 실패했습니다.");
      }

      const payload = data.result ?? null;
      const run =
        payload?.run ??
        (data as unknown as { run?: IssueStatusAutomationRunResult }).run ??
        null;
      const summary =
        payload?.summary ??
        (
          data as unknown as {
            summary?: IssueStatusAutomationSummary | null;
          }
        ).summary ??
        null;

      if (summary) {
        setIssueStatusAutomationSummary(summary);
      }

      if (run) {
        if (run.processed) {
          onFeedback(
            `진행 상태 설정을 완료했습니다. (진행 ${run.insertedInProgress.toLocaleString()}건, 완료 ${run.insertedDone.toLocaleString()}건, 취소 ${Number(run.insertedCanceled ?? 0).toLocaleString()}건)`,
          );
        } else {
          onFeedback("이슈 상태가 이미 최신입니다.");
        }
      } else {
        onFeedback("진행 상태 설정 요청이 완료되었습니다.");
      }

      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "진행 상태 설정 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunningStatusAutomation(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Activity 스냅샷 재생성</CardTitle>
          <CardDescription>
            Activity 화면에서 사용하는 스냅샷을 다시 만들어 최신 저장소/링크
            정보를 즉시 반영합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            최근 생성 시각:{" "}
            <span>
              {activitySnapshotSummary?.lastGeneratedAt
                ? formatDateTime(activitySnapshotSummary.lastGeneratedAt)
                : "-"}
            </span>
          </p>
          {activitySnapshotSummary ? (
            <ul className="space-y-1">
              <li>
                Activity 항목{" "}
                {activitySnapshotSummary.itemCount.toLocaleString()}건
              </li>
              <li>
                저장소{" "}
                {activitySnapshotSummary.repositoryCount.toLocaleString()}개
              </li>
            </ul>
          ) : (
            <p>아직 생성된 Activity 스냅샷 기록이 없습니다.</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleActivitySnapshotRefresh}
            disabled={isRefreshingActivitySnapshot || !canManageSync}
            title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
          >
            {isRefreshingActivitySnapshot
              ? "Activity 스냅샷 재생성 중..."
              : "Activity 스냅샷 재생성"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Activity 캐시 새로고침</CardTitle>
          <CardDescription>
            Activity 필터 옵션과 PR↔이슈 연결 정보를 미리 계산하여 페이지 로딩을
            빠르게 유지합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            최근 생성 시각:{" "}
            <span>
              {activityCacheSummary?.filterOptions.generatedAt
                ? formatDateTime(activityCacheSummary.filterOptions.generatedAt)
                : "-"}
            </span>
          </p>
          {activityCacheSummary ? (
            <ul className="space-y-1">
              <li>
                필터 항목{" "}
                {activityCacheSummary.filterOptions.itemCount.toLocaleString()}
                건
                {activityCacheFilterCounts ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (저장소{" "}
                    {activityCacheFilterCounts.repositories.toLocaleString()}
                    개, 라벨 {activityCacheFilterCounts.labels.toLocaleString()}
                    개, 사용자{" "}
                    {activityCacheFilterCounts.users.toLocaleString()}
                    명)
                  </span>
                ) : null}
              </li>
              <li>
                이슈↔PR 링크{" "}
                {(activityCacheIssueLinkCount ?? 0).toLocaleString()}건
              </li>
              <li>
                PR↔이슈 링크 {(activityCachePrLinkCount ?? 0).toLocaleString()}
                건
              </li>
            </ul>
          ) : (
            <p>아직 실행된 Activity 캐시 새로고침 기록이 없습니다.</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleActivityCacheRefresh}
            disabled={isRefreshingActivityCache || !canManageSync}
            title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
          >
            {isRefreshingActivityCache
              ? "Activity 캐시 새로 고치는 중..."
              : "Activity 캐시 새로고침"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>응답 없는 멘션 분류</CardTitle>
          <CardDescription>
            OpenAI를 사용해 멘션이 실제 응답 요청인지 판별합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            분류 결과는 데이터베이스에 저장되어 Activity 화면의 멘션 주의 항목에
            반영됩니다.
          </p>
          <p>OpenAI API 키가 설정되어 있어야 실행됩니다.</p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">상태</dt>
              <dd className="text-foreground">
                {unansweredStatusLabel ?? "정보 없음"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">최근 실행</dt>
              <dd className="text-foreground">
                {formatDateTime(unansweredLastStartedAtIso) ?? "-"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">최근 완료</dt>
              <dd className="text-foreground">
                {formatDateTime(unansweredLastCompletedAtIso) ?? "-"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">최근 성공</dt>
              <dd className="text-foreground">
                {formatDateTime(unansweredLastSuccessAtIso) ?? "-"}
              </dd>
            </div>
          </dl>
          {unansweredLastError ? (
            <p className="text-xs text-red-600 dark:text-red-300">
              최근 오류: {unansweredLastError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => handleMentionClassification(false)}
            disabled={isClassifyingMentions || !canManageSync}
            title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
          >
            {isClassifyingMentions && mentionClassificationMode === "standard"
              ? "분류 실행 중..."
              : "분류 실행"}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleMentionClassification(true)}
            disabled={isClassifyingMentions || !canManageSync}
            title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
          >
            {isClassifyingMentions && mentionClassificationMode === "force"
              ? "전체 재분류 실행 중..."
              : "전체 재분류"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>진행 상태 설정</CardTitle>
          <CardDescription>
            연결된 PR의 생성과 머지를 기준으로 이슈의 진행 상태를 즉시
            갱신합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="space-y-3">
            {issueStatusAutomationSummary ? (
              <>
                <p>
                  최근 실행 시각:{" "}
                  <span>
                    {formatDateTime(issueStatusAutomationSummary.generatedAt) ??
                      "-"}
                  </span>
                </p>
                <p>
                  최근 성공 시각:{" "}
                  <span>
                    {formatDateTime(
                      issueStatusAutomationSummary.lastSuccessAt,
                    ) ?? "-"}
                  </span>
                </p>
                <p>
                  대상 동기화 시각 (최근 실행):{" "}
                  <span>
                    {formatDateTime(
                      issueStatusAutomationSummary.lastSuccessfulSyncAt,
                    ) ?? "-"}
                  </span>
                </p>
                <p>
                  대상 동기화 시각 (최근 성공):{" "}
                  <span>
                    {formatDateTime(
                      issueStatusAutomationSummary.lastSuccessSyncAt,
                    ) ?? "-"}
                  </span>
                </p>
                <p>
                  최근 실행 결과:{" "}
                  <span>
                    진행{" "}
                    {Number(
                      issueStatusAutomationSummary.insertedInProgress ?? 0,
                    ).toLocaleString()}
                    건, 완료{" "}
                    {Number(
                      issueStatusAutomationSummary.insertedDone ?? 0,
                    ).toLocaleString()}
                    건, 취소{" "}
                    {Number(
                      issueStatusAutomationSummary.insertedCanceled ?? 0,
                    ).toLocaleString()}
                    건
                  </span>
                </p>
                {issueStatusAutomationSummary.trigger ? (
                  <p>
                    최근 트리거:{" "}
                    <span>{issueStatusAutomationSummary.trigger}</span>
                  </p>
                ) : null}
                {issueStatusAutomationSummary.error ? (
                  <p className="text-sm text-red-600">
                    최근 오류: {issueStatusAutomationSummary.error}
                  </p>
                ) : null}
              </>
            ) : (
              <p>아직 실행된 진행 상태 설정 기록이 없습니다.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label
              className="text-muted-foreground"
              htmlFor={statusAutomationStartId}
            >
              대상 동기화 시각 (선택)
            </label>
            <PickerInput
              id={statusAutomationStartId}
              type="datetime-local"
              value={statusAutomationStart}
              onChange={(event) => setStatusAutomationStart(event.target.value)}
              pickerButtonLabel="달력 열기"
            />
            {statusAutomationStart.trim().length ? (
              (() => {
                const parsed = new Date(statusAutomationStart);
                if (Number.isNaN(parsed.getTime())) {
                  return (
                    <p className="text-xs text-destructive">
                      유효하지 않은 시각입니다. 다시 입력해주세요.
                    </p>
                  );
                }
                const display =
                  formatDateTime(parsed.toISOString()) ?? parsed.toISOString();
                return (
                  <p className="text-xs text-muted-foreground">
                    선택된 시각: {display}
                  </p>
                );
              })()
            ) : (
              <p className="text-xs text-muted-foreground">
                비워 두면 마지막 성공 시각을 기준으로 실행합니다.
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleIssueStatusAutomation}
            disabled={isRunningStatusAutomation || !canManageSync}
            title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
          >
            {isRunningStatusAutomation
              ? "진행 상태 설정 중..."
              : "진행 상태 설정"}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
