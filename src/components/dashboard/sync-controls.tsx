"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";

import { SyncSubTabs } from "@/components/dashboard/sync-subtabs";
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
import type { ActivityCacheRefreshResult } from "@/lib/activity/cache";
import type {
  IssueStatusAutomationRunResult,
  IssueStatusAutomationSummary,
} from "@/lib/activity/status-automation";
import {
  type DateTimeDisplayFormat,
  formatDateTime as formatDateTimeDisplay,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import type { BackfillResult, SyncStatus } from "@/lib/sync/service";

type SyncView = "overview" | "logs" | "backup";

type SyncControlsProps = {
  status: SyncStatus;
  isAdmin: boolean;
  timeZone?: string | null;
  dateTimeFormat?: DateTimeDisplayFormat;
  view?: SyncView;
  currentPathname?: string;
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
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

const backupStatusLabels: Record<string, string> = {
  success: "성공",
  failed: "실패",
  running: "진행 중",
  restored: "복구 완료",
  idle: "대기",
};

const backupStatusColors: Record<string, string> = {
  success: "text-emerald-600",
  failed: "text-red-600",
  running: "text-amber-600",
  restored: "text-sky-600",
  idle: "text-muted-foreground",
};

type UnansweredMentionStatusValue =
  | "running"
  | "success"
  | "failed"
  | "partial"
  | "skipped";

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

const backupTriggerLabels: Record<string, string> = {
  automatic: "자동",
  manual: "수동",
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

function formatBytes(size: number | null | undefined) {
  if (size === null || size === undefined || !Number.isFinite(size)) {
    return "-";
  }

  const absolute = Math.max(0, Number(size));
  if (absolute < 1024) {
    return `${Math.round(absolute).toLocaleString()} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = absolute;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export const __syncControlsTestHelpers = {
  parseApiResponse,
  toIsoString,
  formatBytes,
};

type RunLogEntry = {
  id: number;
  resource: string;
  status: "success" | "failed" | "running";
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type RunGroup = {
  id: string;
  runId: number | null;
  runType: "automatic" | "manual" | "backfill" | "legacy";
  strategy: string | null;
  status: "success" | "failed" | "running";
  since: string | null;
  until: string | null;
  startedAt: string | null;
  completedAt: string | null;
  logs: RunLogEntry[];
};

const RUN_TYPE_LABELS: Record<RunGroup["runType"], string> = {
  automatic: "자동 동기화",
  manual: "수동 동기화",
  backfill: "백필",
  legacy: "이전 로그",
};

function compareAsc(a: string | null, b: string | null) {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  const aTime = Number.isNaN(new Date(a).getTime()) ? 0 : new Date(a).getTime();
  const bTime = Number.isNaN(new Date(b).getTime()) ? 0 : new Date(b).getTime();
  return aTime - bTime;
}

function compareDesc(a: string | null, b: string | null) {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  const aTime = Number.isNaN(new Date(a).getTime()) ? 0 : new Date(a).getTime();
  const bTime = Number.isNaN(new Date(b).getTime()) ? 0 : new Date(b).getTime();
  return bTime - aTime;
}

function buildRunGroups(status: SyncStatus): RunGroup[] {
  const groups: RunGroup[] = [];
  const coveredLogIds = new Set<number>();

  for (const run of status.runs ?? []) {
    const logs = [...(run.logs ?? [])]
      .map((log) => ({
        id: log.id,
        resource: log.resource,
        status: log.status,
        message: log.message ?? null,
        startedAt: log.startedAt ?? null,
        finishedAt: log.finishedAt ?? null,
      }))
      .sort((a, b) => compareAsc(a.startedAt, b.startedAt));

    for (const log of logs) {
      coveredLogIds.add(log.id);
    }

    groups.push({
      id: `run-${run.id}`,
      runId: run.id,
      runType: run.runType,
      strategy: run.strategy,
      status: run.status,
      since: run.since ?? null,
      until: run.until ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      logs,
    });
  }

  const legacyBuckets = new Map<
    string,
    { runId: number | null; logs: RunLogEntry[] }
  >();

  for (const log of status.logs ?? []) {
    if (coveredLogIds.has(log.id)) {
      continue;
    }

    const key =
      log.run_id !== null && log.run_id !== undefined
        ? `run-${log.run_id}`
        : `legacy-${log.id}`;
    const bucket = legacyBuckets.get(key) ?? {
      runId: log.run_id ?? null,
      logs: [],
    };

    bucket.logs.push({
      id: log.id,
      resource: log.resource,
      status: log.status,
      message: log.message ?? null,
      startedAt: log.started_at ?? null,
      finishedAt: log.finished_at ?? null,
    });
    legacyBuckets.set(key, bucket);
  }

  let legacyCounter = 0;
  for (const bucket of legacyBuckets.values()) {
    const logs = bucket.logs.sort((a, b) =>
      compareAsc(a.startedAt, b.startedAt),
    );
    let status: RunGroup["status"] = "success";
    if (logs.some((log) => log.status === "failed")) {
      status = "failed";
    } else if (logs.some((log) => log.status === "running")) {
      status = "running";
    }

    const startedAt = logs.find((log) => log.startedAt)?.startedAt ?? null;
    const completedAt =
      [...logs].reverse().find((log) => log.finishedAt)?.finishedAt ?? null;

    groups.push({
      id: `legacy-${legacyCounter++}`,
      runId: bucket.runId,
      runType: bucket.runId ? "automatic" : "legacy",
      strategy: bucket.runId ? "incremental" : null,
      status,
      since: null,
      until: null,
      startedAt,
      completedAt,
      logs,
    });
  }

  groups.sort((a, b) => compareDesc(a.startedAt, b.startedAt));
  return groups;
}

export function SyncControls({
  status,
  isAdmin,
  timeZone: userTimeZone,
  dateTimeFormat: userDateTimeFormat,
  view = "overview",
  currentPathname,
}: SyncControlsProps) {
  const router = useRouter();
  const config = status.config;
  const backupInfo = status.backup;
  const backupSchedule = backupInfo.schedule;
  const backupDirectory = backupInfo.directory;
  const backupRetentionCount = backupInfo.retentionCount;
  const backupRecords = backupInfo.records ?? [];
  const trimmedUserTimeZone =
    typeof userTimeZone === "string" ? userTimeZone.trim() : "";
  const configTimeZone =
    typeof config?.timezone === "string" ? config.timezone.trim() : "";
  const timeZone =
    trimmedUserTimeZone.length > 0
      ? trimmedUserTimeZone
      : configTimeZone.length > 0
        ? configTimeZone
        : null;
  const dateTimeFormat = useMemo(
    () =>
      userDateTimeFormat ??
      normalizeDateTimeDisplayFormat(
        typeof config?.date_time_format === "string"
          ? config.date_time_format
          : null,
      ),
    [config?.date_time_format, userDateTimeFormat],
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
  const [activityCacheSummary, setActivityCacheSummary] =
    useState<ActivityCacheRefreshResult | null>(null);
  const [issueStatusAutomationSummary, setIssueStatusAutomationSummary] =
    useState<IssueStatusAutomationSummary | null>(null);
  const [statusAutomationStart, setStatusAutomationStart] = useState("");
  const [backupHour, setBackupHour] = useState(backupSchedule.hourLocal ?? 2);
  const [isSavingBackupSchedule, setIsSavingBackupSchedule] = useState(false);
  const [isRunningBackup, setIsRunningBackup] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(
    null,
  );
  const backupHourSelectId = useId();
  const backupHourOptions = useMemo(
    () => Array.from({ length: 24 }, (_value, hour) => hour),
    [],
  );
  const [isRunningBackfill, setIsRunningBackfill] = useState(false);
  const [isTogglingAuto, setIsTogglingAuto] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isRefreshingActivityCache, setIsRefreshingActivityCache] =
    useState(false);
  const [isRunningStatusAutomation, setIsRunningStatusAutomation] =
    useState(false);
  const [isClassifyingMentions, setIsClassifyingMentions] = useState(false);
  const [mentionClassificationMode, setMentionClassificationMode] = useState<
    "standard" | "force"
  >("standard");
  const activityCacheFilterCounts = activityCacheSummary
    ? parseFilterCounts(activityCacheSummary.filterOptions.metadata)
    : null;
  const activityCacheIssueLinkCount = activityCacheSummary
    ? parseLinkCount(activityCacheSummary.issueLinks.metadata)
    : null;
  const activityCachePrLinkCount = activityCacheSummary
    ? parseLinkCount(activityCacheSummary.pullRequestLinks.metadata)
    : null;

  const canManageSync = isAdmin;

  useEffect(() => {
    setAutoEnabled(config?.auto_sync_enabled ?? false);
  }, [config?.auto_sync_enabled]);

  useEffect(() => {
    setBackupHour(backupSchedule.hourLocal ?? 2);
  }, [backupSchedule.hourLocal]);

  useEffect(() => {
    if (!canManageSync) {
      setActivityCacheSummary(null);
      setIssueStatusAutomationSummary(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadSummary = async () => {
      try {
        const response = await fetch("/api/activity/cache/refresh", {
          method: "GET",
          signal: controller.signal,
        });
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
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn(
            "[sync-controls] Failed to load Activity cache summary",
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
  }, [canManageSync]);

  useEffect(() => {
    if (!canManageSync) {
      setIssueStatusAutomationSummary(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadAutomationSummary = async () => {
      try {
        const response = await fetch("/api/activity/status-automation", {
          method: "GET",
          signal: controller.signal,
        });
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
            "[sync-controls] Failed to load issue status automation summary",
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
  }, [canManageSync]);

  const runGroups = useMemo(() => buildRunGroups(status), [status]);
  const primaryLatestRun = useMemo(
    () => runGroups.find((run) => run.runType !== "legacy") ?? null,
    [runGroups],
  );
  const fallbackLatestRun = runGroups[0] ?? null;

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

  const backupStatusKey = (backupSchedule.lastStatus ?? "idle").toLowerCase();
  const backupStatusLabel =
    backupStatusLabels[backupStatusKey] ?? capitalize(backupStatusKey);
  const backupStatusClass =
    backupStatusColors[backupStatusKey] ?? "text-muted-foreground";
  const backupNextRunLabel = backupSchedule.nextRunAt
    ? formatDateTime(backupSchedule.nextRunAt)
    : null;
  const backupLastRange = formatRange(
    backupSchedule.lastStartedAt ?? null,
    backupSchedule.lastCompletedAt ?? null,
  );
  const backupLastError = backupSchedule.lastError ?? null;
  const backupTimezoneLabel = timeZone ?? backupSchedule.timezone ?? "UTC";

  const viewPathMap: Record<SyncView, string> = {
    overview: "/dashboard/sync",
    logs: "/dashboard/sync/logs",
    backup: "/dashboard/sync/backup",
  };
  const sectionIdMap: Record<SyncView, string> = {
    overview: "sync-overview",
    logs: "logs-section",
    backup: "backup-section",
  };
  const activePath = currentPathname ?? viewPathMap[view];
  const sectionId = sectionIdMap[view];

  function formatHourLabel(hour: number) {
    const normalized = Math.min(Math.max(Math.round(hour), 0), 23);
    return `${normalized.toString().padStart(2, "0")}:00`;
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

  const fallbackSuccessfulSyncStartedAt = useMemo(() => {
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
  const lastSuccessfulRun = useMemo(
    () =>
      runGroups.find(
        (run) => run.runType !== "legacy" && run.status === "success",
      ) ?? null,
    [runGroups],
  );
  const lastSuccessfulSyncStartedAt =
    toIsoString(lastSuccessfulRun?.startedAt ?? null) ??
    fallbackSuccessfulSyncStartedAt;
  const lastSuccessfulSyncCompletedAt = toIsoString(
    lastSuccessfulRun?.completedAt ??
      config?.last_successful_sync_at ??
      fallbackLatestRun?.completedAt ??
      null,
  );
  const latestSyncStartedAt =
    toIsoString(primaryLatestRun?.startedAt ?? null) ??
    toIsoString(config?.last_sync_started_at ?? null) ??
    toIsoString(fallbackLatestRun?.startedAt ?? null);
  const latestSyncCompletedAt =
    toIsoString(primaryLatestRun?.completedAt ?? null) ??
    toIsoString(config?.last_sync_completed_at ?? null) ??
    toIsoString(fallbackLatestRun?.completedAt ?? null);
  const nextAutomaticSyncAt = useMemo(() => {
    if (!autoEnabled) {
      return null;
    }

    const intervalMinutes = config?.sync_interval_minutes ?? null;
    if (!intervalMinutes || intervalMinutes <= 0) {
      return null;
    }

    const lastCompletedIso = latestSyncCompletedAt;
    if (!lastCompletedIso) {
      return null;
    }

    const lastCompleted = new Date(lastCompletedIso);
    if (Number.isNaN(lastCompleted.getTime())) {
      return null;
    }

    return new Date(
      lastCompleted.getTime() + intervalMinutes * 60 * 1000,
    ).toISOString();
  }, [autoEnabled, config?.sync_interval_minutes, latestSyncCompletedAt]);

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

  async function handleBackfill() {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (!backfillDate) {
      setFeedback("백필 시작 날짜를 선택하세요.");
      return;
    }

    setIsRunningBackfill(true);
    try {
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
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "백필 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunningBackfill(false);
    }
  }

  async function handleAutoToggle(nextEnabled: boolean) {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    setIsTogglingAuto(true);
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
    } finally {
      setIsTogglingAuto(false);
    }
  }

  async function handleCleanup() {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      !window.confirm(
        "진행 중으로 표시된 동기화를 실패 처리할까요? 최근 중단된 백필/자동 동기화가 모두 정리됩니다.",
      )
    ) {
      return;
    }

    setIsCleaning(true);
    try {
      const response = await fetch("/api/sync/admin/cleanup", {
        method: "POST",
      });
      const data = await parseApiResponse<{
        runCount: number;
        logCount: number;
      }>(response);

      if (!data.success) {
        throw new Error(
          data.message ?? "멈춰 있는 동기화를 정리하지 못했습니다.",
        );
      }

      const counts = data.result ?? { runCount: 0, logCount: 0 };
      const total = (counts.runCount ?? 0) + (counts.logCount ?? 0);
      if (total > 0) {
        setFeedback(
          `멈춰 있던 런 ${counts.runCount ?? 0}건과 로그 ${counts.logCount ?? 0}건을 실패 처리했습니다.`,
        );
      } else {
        setFeedback("정리할 동기화가 없습니다.");
      }
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "동기화 정리 작업 중 오류가 발생했습니다.",
      );
    } finally {
      setIsCleaning(false);
    }
  }

  async function handleRunBackup() {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "지금 백업을 실행할까요? 동기화 중이라면 완료 후 백업이 시작됩니다.",
      )
    ) {
      return;
    }

    setIsRunningBackup(true);
    try {
      const response = await fetch("/api/backup/run", {
        method: "POST",
      });
      const data = await parseApiResponse<unknown>(response);
      if (!data.success) {
        throw new Error(data.message ?? "백업 실행에 실패했습니다.");
      }

      setFeedback(data.message ?? "백업을 완료했습니다.");
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "백업 실행 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunningBackup(false);
    }
  }

  async function handleBackupScheduleSave() {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (!Number.isFinite(backupHour) || backupHour < 0 || backupHour > 23) {
      setFeedback("백업 시각은 0시에서 23시 사이여야 합니다.");
      return;
    }

    setIsSavingBackupSchedule(true);
    try {
      const response = await fetch("/api/sync/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ backupHour }),
      });
      const data = await parseApiResponse<SyncStatus>(response);
      if (!data.success) {
        throw new Error(data.message ?? "백업 시각 저장에 실패했습니다.");
      }

      setFeedback("백업 실행 시간을 저장했습니다.");
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "백업 시간 저장 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSavingBackupSchedule(false);
    }
  }

  async function handleRestoreBackup(restoreKey: string) {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "선택한 백업으로 복구할까요? 현재 동기화는 종료되고 데이터가 덮어쓰여집니다.",
      )
    ) {
      return;
    }

    setRestoringBackupId(restoreKey);
    try {
      const response = await fetch(`/api/backup/${restoreKey}/restore`, {
        method: "POST",
      });
      const data = await parseApiResponse<unknown>(response);
      if (!data.success) {
        throw new Error(data.message ?? "백업 복구에 실패했습니다.");
      }

      setFeedback("백업 복구를 완료했습니다.");
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "백업 복구 중 오류가 발생했습니다.",
      );
    } finally {
      setRestoringBackupId(null);
    }
  }

  async function handleActivityCacheRefresh() {
    if (!canManageSync) {
      setFeedback(ADMIN_ONLY_MESSAGE);
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
        setFeedback(
          `Activity 캐시를 새로 고쳤습니다. (${filterLabel}, 이슈 링크 ${issueLinkCount.toLocaleString()}건, PR 링크 ${prLinkCount.toLocaleString()}건)`,
        );
      } else {
        setFeedback("Activity 캐시 새로고침 요청이 완료되었습니다.");
      }

      router.refresh();
    } catch (error) {
      setFeedback(
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
      setFeedback(ADMIN_ONLY_MESSAGE);
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
        setFeedback(detail.length ? `${baseMessage} (${detail})` : baseMessage);
      } else {
        setFeedback("응답 없는 멘션 분류를 완료했습니다.");
      }
      router.refresh();
    } catch (error) {
      setFeedback(
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
      setFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    let overrideStartAt: string | undefined;
    if (statusAutomationStart.trim().length) {
      const parsed = new Date(statusAutomationStart);
      if (Number.isNaN(parsed.getTime())) {
        setFeedback("유효한 시작 시각을 입력하세요.");
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
          setFeedback(
            `진행 상태 설정을 완료했습니다. (진행 ${run.insertedInProgress.toLocaleString()}건, 완료 ${run.insertedDone.toLocaleString()}건, 취소 ${Number(run.insertedCanceled ?? 0).toLocaleString()}건)`,
          );
        } else {
          setFeedback("이슈 상태가 이미 최신입니다.");
        }
      } else {
        setFeedback("진행 상태 설정 요청이 완료되었습니다.");
      }

      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "진행 상태 설정 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunningStatusAutomation(false);
    }
  }

  return (
    <section id={sectionId} className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <h2 className="sr-only">데이터 동기화 제어</h2>
        <p className="text-sm text-muted-foreground">
          조직({config?.org_name})의 GitHub 데이터 수집과 동기화를 관리합니다.
        </p>
        <SyncSubTabs currentPathname={activePath} />
        {!canManageSync ? (
          <p className="text-sm text-muted-foreground">{ADMIN_ONLY_MESSAGE}</p>
        ) : null}
        {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}
      </header>

      {view === "overview" && (
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
                  {formatRange(latestSyncStartedAt, latestSyncCompletedAt)}
                </span>
              </p>
              <p>
                마지막 성공:{" "}
                <span>
                  {formatRange(
                    lastSuccessfulSyncStartedAt,
                    lastSuccessfulSyncCompletedAt,
                  )}
                </span>
              </p>
              <p>
                간격: {(config?.sync_interval_minutes ?? 60).toLocaleString()}분
              </p>
              <p>
                다음 동기화 예정:{" "}
                <span>
                  {nextAutomaticSyncAt
                    ? formatDateTime(nextAutomaticSyncAt)
                    : "-"}
                </span>
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

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>멈춰 있는 동기화 정리</CardTitle>
              <CardDescription>
                중단된 백필이나 자동 동기화가 계속 &ldquo;진행 중&rdquo;으로
                보일 때 실패 처리하여 상태를 정리합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                실패 처리된 런과 로그는 다시 실행되지 않으며, 필요 시 새로
                동기화를 시작해야 합니다.
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                onClick={handleCleanup}
                disabled={isCleaning || !canManageSync}
                title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
              >
                {isCleaning ? "정리 중..." : "멈춘 동기화 정리"}
              </Button>
            </CardFooter>
          </Card>
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>Activity 캐시 새로고침</CardTitle>
              <CardDescription>
                Activity 필터 옵션과 PR↔이슈 연결 정보를 미리 계산하여 페이지
                로딩을 빠르게 유지합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                최근 생성 시각:{" "}
                <span>
                  {activityCacheSummary?.filterOptions.generatedAt
                    ? formatDateTime(
                        activityCacheSummary.filterOptions.generatedAt,
                      )
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
                        개, 라벨{" "}
                        {activityCacheFilterCounts.labels.toLocaleString()}개,
                        사용자{" "}
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
                    PR↔이슈 링크{" "}
                    {(activityCachePrLinkCount ?? 0).toLocaleString()}건
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
                분류 결과는 데이터베이스에 저장되어 Activity 화면의 멘션 주의
                항목에 반영됩니다.
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
                {isClassifyingMentions &&
                mentionClassificationMode === "standard"
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
                        {formatDateTime(
                          issueStatusAutomationSummary.generatedAt,
                        ) ?? "-"}
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
                <span className="text-muted-foreground">
                  대상 동기화 시각 (선택)
                </span>
                <Input
                  type="datetime-local"
                  value={statusAutomationStart}
                  onChange={(event) =>
                    setStatusAutomationStart(event.target.value)
                  }
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
                      formatDateTime(parsed.toISOString()) ??
                      parsed.toISOString();
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
        </div>
      )}

      {view === "backup" && (
        <section
          id="backup-section"
          className="grid gap-6 lg:grid-cols-2"
          aria-labelledby="sync-backup-heading"
        >
          <h3 id="sync-backup-heading" className="sr-only">
            백업
          </h3>
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>DB 백업 일정</CardTitle>
              <CardDescription>
                매일 지정한 시간에 데이터베이스 백업을 생성합니다.
              </CardDescription>
              <CardAction>
                <span
                  className={`rounded-full bg-muted px-3 py-1 text-xs ${backupStatusClass}`}
                >
                  {backupStatusLabel}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor={backupHourSelectId}
                      className="text-sm font-medium text-foreground"
                    >
                      백업 실행 시각 ({backupTimezoneLabel})
                    </label>
                    <select
                      id={backupHourSelectId}
                      value={backupHour}
                      onChange={(event) =>
                        setBackupHour(Number.parseInt(event.target.value, 10))
                      }
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      disabled={!canManageSync}
                      title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
                    >
                      {backupHourOptions.map((hour) => (
                        <option key={hour} value={hour}>
                          {formatHourLabel(hour)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      동기화가 진행 중이면 완료된 뒤에 백업이 실행됩니다.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleBackupScheduleSave}
                    disabled={
                      isSavingBackupSchedule ||
                      isRunningBackup ||
                      !canManageSync
                    }
                    title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
                    className="sm:self-start"
                  >
                    {isSavingBackupSchedule ? "저장 중..." : "백업 시각 저장"}
                  </Button>
                </div>
              </div>
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <div className="space-y-1">
                  <p>
                    다음 백업: <span>{backupNextRunLabel ?? "-"}</span>
                  </p>
                  <p>
                    최근 실행: <span>{backupLastRange}</span>
                  </p>
                  <p>
                    최근 상태:{" "}
                    <span className={`${backupStatusClass} font-medium`}>
                      {backupStatusLabel}
                    </span>
                  </p>
                  {backupLastError ? (
                    <p className="text-sm text-destructive">
                      최근 오류: {backupLastError}
                    </p>
                  ) : null}
                </div>
                <Button
                  onClick={handleRunBackup}
                  disabled={isRunningBackup || !canManageSync}
                  title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
                  className="w-full sm:w-auto"
                >
                  {isRunningBackup ? "백업 실행 중..." : "지금 백업하기"}
                </Button>
              </div>
              <div className="space-y-1">
                <p>
                  저장 경로:{" "}
                  <code className="break-all text-xs text-foreground">
                    {backupDirectory}
                  </code>
                </p>
                <p>최대 보존: {backupRetentionCount.toLocaleString()}개</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 lg:col-span-2">
            <CardHeader>
              <CardTitle>백업 파일</CardTitle>
              <CardDescription>
                최근 백업을 확인하고 필요 시 복구할 수 있습니다.
              </CardDescription>
              <CardAction>
                <span className="text-xs text-muted-foreground">
                  총 {backupRecords.length.toLocaleString()}건
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {backupRecords.length === 0 ? (
                <p>아직 생성된 백업이 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {backupRecords.map((record) => {
                    const recordStatusClass =
                      backupStatusColors[record.status] ??
                      "text-muted-foreground";
                    const recordStatusLabel =
                      backupStatusLabels[record.status] ?? record.status;
                    const isAdditionalFile = record.isAdditionalFile;
                    const triggerLabel = isAdditionalFile
                      ? "디렉터리 감지"
                      : (backupTriggerLabels[record.trigger] ?? record.trigger);
                    const restoreInProgress =
                      restoringBackupId === record.restoreKey;
                    return (
                      <div
                        key={record.restoreKey}
                        className="flex w-full flex-wrap items-start gap-3 rounded-md border border-border/50 p-3"
                      >
                        <div className="min-w-[220px] flex-1 space-y-1">
                          <p className="font-medium text-foreground">
                            {record.filename}
                            {isAdditionalFile ? (
                              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                추가된 파일
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            생성{" "}
                            {formatRange(record.startedAt, record.completedAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            경로:{" "}
                            <code className="break-all text-[11px] text-foreground">
                              {record.directory}
                            </code>
                          </p>
                        </div>
                        <div className="flex min-w-[200px] flex-col gap-1 text-xs text-muted-foreground">
                          <span>
                            상태:{" "}
                            <span
                              className={`${recordStatusClass} font-medium`}
                            >
                              {recordStatusLabel}
                            </span>
                          </span>
                          <span>트리거: {triggerLabel}</span>
                          <span>크기: {formatBytes(record.sizeBytes)}</span>
                          {record.restoredAt ? (
                            <span>
                              마지막 복구:{" "}
                              {formatDateTime(record.restoredAt) ??
                                record.restoredAt}
                            </span>
                          ) : null}
                          {record.error ? (
                            <span className="text-destructive">
                              오류: {record.error}
                            </span>
                          ) : null}
                        </div>
                        {canManageSync && record.status === "success" ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              handleRestoreBackup(record.restoreKey)
                            }
                            disabled={restoreInProgress}
                          >
                            {restoreInProgress ? "복구 중..." : "복구"}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}
      {view === "overview" && backfillHistory.length > 0 && (
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

      {view === "logs" && (
        <section
          id="logs-section"
          className="mt-4 space-y-4"
          aria-labelledby="sync-logs-heading"
        >
          <h3 id="sync-logs-heading" className="sr-only">
            동기화 로그
          </h3>
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>최근 동기화 로그</CardTitle>
              <CardDescription>
                각 리소스의 실행 상태와 메시지를 확인합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {runGroups.length === 0 ? (
                <p className="text-muted-foreground">로그가 없습니다.</p>
              ) : (
                runGroups.map((run) => (
                  <div
                    key={run.id}
                    className="space-y-3 rounded-lg border border-border/60 bg-background px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-foreground">
                          {RUN_TYPE_LABELS[run.runType] ?? "동기화"} •{" "}
                          {formatRange(run.startedAt, run.completedAt)}
                        </span>
                        {run.since || run.until ? (
                          <span className="text-xs text-muted-foreground">
                            실행 범위: {formatRange(run.since, run.until)}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={`text-xs font-semibold ${statusColors[run.status] ?? ""}`}
                      >
                        {capitalize(run.status)}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {run.logs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          리소스 로그가 없습니다.
                        </p>
                      ) : (
                        run.logs.map((log) => (
                          <div
                            key={log.id}
                            className="rounded-md border border-border/50 bg-muted/10 px-3 py-2"
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
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatRange(log.startedAt, log.finishedAt)}
                            </p>
                            {log.message ? (
                              <p className="mt-1 text-sm text-foreground">
                                {log.message}
                              </p>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </section>
  );
}
