"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import type { useAuthorizedFetch } from "@/components/dashboard/hooks/use-authorized-fetch";
import { SyncDataToolsPanel } from "@/components/dashboard/sync/sync-data-tools-panel";
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
import { PickerInput } from "@/components/ui/picker-input";
import {
  type DateTimeDisplayFormat,
  formatDateTime as formatDateTimeDisplay,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import type { BackfillResult, SyncStatus } from "@/lib/sync/service";

// ---------------------------------------------------------------------------
// Private types
// ---------------------------------------------------------------------------

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
  reauthRequired?: boolean;
};

type BackfillHistoryEntry = {
  id: string;
  report: BackfillResult;
};

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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createBackfillHistoryEntry(
  report: BackfillResult,
): BackfillHistoryEntry {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: `backfill-${id}`,
    report,
  };
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

const backupStatusLabels: Record<string, string> = {
  success: "성공",
  failed: "실패",
  running: "진행 중",
  waiting: "대기 중",
  restored: "복구 완료",
  idle: "대기",
};

const backupStatusColors: Record<string, string> = {
  success: "text-emerald-600",
  failed: "text-red-600",
  running: "text-amber-600",
  waiting: "text-amber-600",
  restored: "text-sky-600",
  idle: "text-muted-foreground",
};

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 실행할 수 있습니다.";

function formatHourLabel(hour: number) {
  const normalized = Math.min(Math.max(Math.round(hour), 0), 23);
  return `${normalized.toString().padStart(2, "0")}:00`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SyncOverviewPanelProps = {
  status: SyncStatus;
  canManageSync: boolean;
  timeZone: string | null;
  dateTimeFormat?: DateTimeDisplayFormat;
  onFeedback: (message: string | null) => void;
  onReauthRequired: () => void;
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyncOverviewPanel({
  status,
  canManageSync,
  timeZone,
  dateTimeFormat: userDateTimeFormat,
  onFeedback,
  onReauthRequired,
  authorizedFetch,
}: SyncOverviewPanelProps) {
  const router = useRouter();
  const config = status.config;
  const transferInfo = status.transferSync;
  const transferSchedule = transferInfo.schedule;

  // -------------------------------------------------------------------------
  // Derived constants
  // -------------------------------------------------------------------------

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
  const backfillEndInputId = useId();
  const transferHourSelectId = useId();
  const transferMinuteSelectId = useId();

  const backupHourOptions = useMemo(
    () => Array.from({ length: 24 }, (_value, hour) => hour),
    [],
  );
  const transferMinuteOptions = useMemo(
    () => Array.from({ length: 60 }, (_value, minute) => minute),
    [],
  );

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [autoEnabled, setAutoEnabled] = useState(
    config?.auto_sync_enabled ?? false,
  );
  const [backfillDate, setBackfillDate] = useState("");
  const [backfillEndDate, setBackfillEndDate] = useState("");
  const [backfillHistory, setBackfillHistory] = useState<
    BackfillHistoryEntry[]
  >([]);
  const [transferHour, setTransferHour] = useState(
    transferSchedule.hourLocal ?? 0,
  );
  const [transferMinute, setTransferMinute] = useState(
    transferSchedule.minuteLocal ?? 0,
  );
  const [isSavingTransferSchedule, setIsSavingTransferSchedule] =
    useState(false);
  const [isRunningTransferSync, setIsRunningTransferSync] = useState(
    transferInfo.isRunning || transferInfo.isWaiting,
  );
  const [isRunningBackfill, setIsRunningBackfill] = useState(false);
  const [isTogglingAuto, setIsTogglingAuto] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isCleaningTransfer, setIsCleaningTransfer] = useState(false);
  const [isCleaningBackup, setIsCleaningBackup] = useState(false);

  // -------------------------------------------------------------------------
  // parseApiResponseWithReauth helper
  // -------------------------------------------------------------------------

  const parseApiResponseWithReauth = async <T,>(
    response: Response,
  ): Promise<ApiResponse<T> | null> => {
    const data = await parseApiResponse<T>(response);
    if (response.status === 428 || data.reauthRequired) {
      onReauthRequired();
      return null;
    }
    return data;
  };

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setAutoEnabled(config?.auto_sync_enabled ?? false);
  }, [config?.auto_sync_enabled]);

  useEffect(() => {
    setTransferHour(transferSchedule.hourLocal ?? 0);
  }, [transferSchedule.hourLocal]);

  useEffect(() => {
    setTransferMinute(transferSchedule.minuteLocal ?? 0);
  }, [transferSchedule.minuteLocal]);

  useEffect(() => {
    setIsRunningTransferSync(transferInfo.isRunning || transferInfo.isWaiting);
  }, [transferInfo.isRunning, transferInfo.isWaiting]);

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

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

  const transferStatusKey = transferInfo.isRunning
    ? "running"
    : transferInfo.isWaiting
      ? "waiting"
      : (transferSchedule.lastStatus ?? "idle").toLowerCase();
  const transferStatusLabel =
    backupStatusLabels[transferStatusKey] ?? capitalize(transferStatusKey);
  const transferStatusClass =
    backupStatusColors[transferStatusKey] ?? "text-muted-foreground";
  const transferNextRunLabel = transferSchedule.nextRunAt
    ? formatDateTime(transferSchedule.nextRunAt)
    : "-";
  const transferLastRange = formatRange(
    transferSchedule.lastStartedAt ?? null,
    transferSchedule.lastCompletedAt ?? null,
  );
  const transferLastError = transferSchedule.lastError ?? null;
  const transferTimezoneLabel = timeZone ?? transferSchedule.timezone ?? "UTC";

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

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  async function handleBackfill() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    const startValue = backfillDate.trim();
    const endValue = backfillEndDate.trim();
    const hasStart = startValue.length > 0;
    const hasEnd = endValue.length > 0;

    if (hasStart && startValue.length !== 10) {
      onFeedback("유효한 시작 날짜 형식을 입력하세요.");
      return;
    }

    if (hasEnd && endValue.length !== 10) {
      onFeedback("유효한 종료 날짜 형식을 입력하세요.");
      return;
    }

    const todayLabel = new Date().toISOString().slice(0, 10);
    if (hasStart && startValue > todayLabel) {
      onFeedback("백필 시작 날짜는 오늘 이후일 수 없습니다.");
      return;
    }

    if (hasEnd && endValue > todayLabel) {
      onFeedback("백필 종료 날짜는 오늘 이후일 수 없습니다.");
      return;
    }

    if (hasStart && hasEnd && endValue < startValue) {
      onFeedback("백필 종료 날짜는 시작 날짜 이후여야 합니다.");
      return;
    }

    setIsRunningBackfill(true);
    try {
      const response = await fetch("/api/sync/backfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: hasStart ? startValue : null,
          endDate: hasEnd ? endValue : null,
        }),
      });
      const data = await parseApiResponse<BackfillResult>(response);

      if (!data.success) {
        throw new Error(data.message ?? "백필 실행에 실패했습니다.");
      }

      const report = data.result ?? null;
      if (report) {
        setBackfillHistory((previous) =>
          [createBackfillHistoryEntry(report), ...previous].slice(0, 5),
        );
        const failedChunk = report.chunks.find(
          (chunk) => chunk.status === "failed",
        );
        if (failedChunk && failedChunk.status === "failed") {
          onFeedback(
            `백필이 ${formatRange(failedChunk.since, failedChunk.until)} 구간에서 실패했습니다: ${failedChunk.error}`,
          );
        } else {
          onFeedback("백필이 성공적으로 실행되었습니다.");
        }
      } else {
        onFeedback("백필이 성공적으로 실행되었습니다.");
      }
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : "백필 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunningBackfill(false);
    }
  }

  async function handleAutoToggle(nextEnabled: boolean) {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
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
      onFeedback(
        nextEnabled
          ? "자동 동기화를 실행했습니다."
          : "자동 동기화를 중단했습니다.",
      );
      router.refresh();
    } catch (error) {
      onFeedback(
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
      onFeedback(ADMIN_ONLY_MESSAGE);
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
      const data = await parseApiResponseWithReauth<{
        runCount: number;
        logCount: number;
      }>(response);
      if (!data) {
        return;
      }

      if (!data.success) {
        throw new Error(
          data.message ?? "멈춰 있는 동기화를 정리하지 못했습니다.",
        );
      }

      const counts = data.result ?? { runCount: 0, logCount: 0 };
      const total = (counts.runCount ?? 0) + (counts.logCount ?? 0);
      if (total > 0) {
        onFeedback(
          `멈춰 있던 런 ${counts.runCount ?? 0}건과 로그 ${counts.logCount ?? 0}건을 실패 처리했습니다.`,
        );
      } else {
        onFeedback("정리할 동기화가 없습니다.");
      }
      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "동기화 정리 작업 중 오류가 발생했습니다.",
      );
    } finally {
      setIsCleaning(false);
    }
  }

  async function handleTransferCleanup() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "멈춰 있는 Transfer 동기화를 실패 처리하고 상태를 초기화할까요?",
      )
    ) {
      return;
    }

    setIsCleaningTransfer(true);
    try {
      const response = await fetch("/api/sync/transfer/cleanup", {
        method: "POST",
      });
      const data = await parseApiResponse<unknown>(response);
      if (!data.success) {
        throw new Error(data.message ?? "Transfer 동기화 정리에 실패했습니다.");
      }

      onFeedback(
        data.message ?? "멈춰 있는 Transfer 동기화를 실패 처리했습니다.",
      );
      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "Transfer 동기화 정리 중 오류가 발생했습니다.",
      );
    } finally {
      setIsCleaningTransfer(false);
    }
  }

  async function handleBackupCleanup() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm("멈춰 있는 DB 백업을 실패 처리하고 상태를 초기화할까요?")
    ) {
      return;
    }

    setIsCleaningBackup(true);
    try {
      const response = await fetch("/api/sync/backup/cleanup", {
        method: "POST",
      });
      const data = await parseApiResponseWithReauth<unknown>(response);
      if (!data) {
        return;
      }
      if (!data.success) {
        throw new Error(data.message ?? "DB 백업 정리에 실패했습니다.");
      }

      onFeedback(data.message ?? "멈춰 있는 DB 백업을 실패 처리했습니다.");
      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "DB 백업 정리 중 오류가 발생했습니다.",
      );
    } finally {
      setIsCleaningBackup(false);
    }
  }

  async function handleTransferScheduleSave() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      !Number.isFinite(transferHour) ||
      transferHour < 0 ||
      transferHour > 23
    ) {
      onFeedback("Transfer 동기화 시각은 0시에서 23시 사이여야 합니다.");
      return;
    }

    if (
      !Number.isFinite(transferMinute) ||
      transferMinute < 0 ||
      transferMinute > 59
    ) {
      onFeedback("Transfer 동기화 분은 0분에서 59분 사이여야 합니다.");
      return;
    }

    setIsSavingTransferSchedule(true);
    try {
      const response = await fetch("/api/sync/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transferSyncHour: transferHour,
          transferSyncMinute: transferMinute,
        }),
      });
      const data = await parseApiResponse<SyncStatus>(response);
      if (!data.success) {
        throw new Error(
          data.message ?? "Transfer 동기화 시간을 저장하지 못했습니다.",
        );
      }

      onFeedback("Transfer 항목 동기화 시간을 저장했습니다.");
      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "Transfer 동기화 시간 저장 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSavingTransferSchedule(false);
    }
  }

  async function handleTransferSyncRun() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "지금 Transfer 항목 동기화를 실행할까요? 실행 중에는 자동 동기화와 백업이 순차적으로 대기합니다.",
      )
    ) {
      return;
    }

    setIsRunningTransferSync(true);
    try {
      const response = await fetch("/api/sync/transfer/run", {
        method: "POST",
      });
      const data = await parseApiResponse<{
        summary?: { updated: number; candidates: number };
      }>(response);

      if (!data.success) {
        throw new Error(
          data.message ?? "Transfer 항목 동기화를 실행하지 못했습니다.",
        );
      }

      const summary = data.result?.summary ?? null;
      if (summary) {
        onFeedback(
          `Transfer 항목 ${summary.updated.toLocaleString()}건을 업데이트했습니다 (후보 ${summary.candidates.toLocaleString()}건).`,
        );
      } else {
        onFeedback("Transfer 항목 동기화를 완료했습니다.");
      }

      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "Transfer 항목 동기화 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunningTransferSync(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>수동 데이터 백필</CardTitle>
            <CardDescription>
              선택한 기간 동안의 데이터를 즉시 수집합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 text-sm">
              <label
                className="text-muted-foreground"
                htmlFor={backfillInputId}
              >
                시작 날짜
              </label>
              <PickerInput
                id={backfillInputId}
                value={backfillDate}
                onChange={(event) => setBackfillDate(event.target.value)}
                pickerButtonLabel="달력 열기"
              />
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <label
                className="text-muted-foreground"
                htmlFor={backfillEndInputId}
              >
                종료 날짜
              </label>
              <PickerInput
                id={backfillEndInputId}
                value={backfillEndDate}
                onChange={(event) => setBackfillEndDate(event.target.value)}
                pickerButtonLabel="달력 열기"
              />
            </div>
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
            <CardTitle>Transfer 항목 동기화</CardTitle>
            <CardDescription>
              매일 지정한 시간에 저장소가 변경된 아이템을 확인하여 최신 상태로
              유지합니다.
            </CardDescription>
            <CardAction>
              <span
                className={`rounded-full bg-muted px-3 py-1 text-xs ${transferStatusClass}`}
              >
                {transferStatusLabel}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={transferHourSelectId}
                    className="text-sm font-medium text-foreground"
                  >
                    Transfer 동기화 실행 시각 ({transferTimezoneLabel})
                  </label>
                  <div className="flex gap-2">
                    <select
                      id={transferHourSelectId}
                      value={transferHour}
                      onChange={(event) =>
                        setTransferHour(Number.parseInt(event.target.value, 10))
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
                    <div className="flex flex-col">
                      <label
                        htmlFor={transferMinuteSelectId}
                        className="sr-only"
                      >
                        Transfer 실행 분
                      </label>
                      <select
                        id={transferMinuteSelectId}
                        value={transferMinute}
                        onChange={(event) =>
                          setTransferMinute(
                            Number.parseInt(event.target.value, 10),
                          )
                        }
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        disabled={!canManageSync}
                        title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
                      >
                        {transferMinuteOptions.map((minute) => (
                          <option key={minute} value={minute}>
                            {minute.toString().padStart(2, "0")}분
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    실행 중에는 자동 동기화와 백업이 순차적으로 대기합니다.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTransferScheduleSave}
                  disabled={
                    isSavingTransferSchedule ||
                    isRunningTransferSync ||
                    !canManageSync
                  }
                  title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
                  className="sm:self-start"
                >
                  {isSavingTransferSchedule ? "저장 중..." : "시각 저장"}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <p>
                다음 실행: <span>{transferNextRunLabel}</span>
              </p>
              <p>
                최근 실행: <span>{transferLastRange}</span>
              </p>
              <p>
                최근 상태:{" "}
                <span className={`${transferStatusClass} font-medium`}>
                  {transferStatusLabel}
                </span>
              </p>
              {transferLastError ? (
                <p className="text-sm text-destructive">
                  최근 오류: {transferLastError}
                </p>
              ) : null}
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleTransferSyncRun}
              disabled={isRunningTransferSync || !canManageSync}
              title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
              className="w-full sm:w-auto"
            >
              {isRunningTransferSync ? "재정렬 실행 중..." : "지금 실행"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>멈춰 있는 동기화 정리</CardTitle>
            <CardDescription>
              중단된 백필이나 자동 동기화가 계속 &ldquo;진행 중&rdquo;으로 보일
              때 실패 처리하여 상태를 정리합니다. Transfer 동기화나 DB 백업도
              별도 버튼으로 정리할 수 있습니다.
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
            <Button
              variant="outline"
              onClick={handleTransferCleanup}
              disabled={isCleaningTransfer || !canManageSync}
              title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
            >
              {isCleaningTransfer ? "정리 중..." : "Transfer 동기화 정리"}
            </Button>
            <Button
              variant="outline"
              onClick={handleBackupCleanup}
              disabled={isCleaningBackup || !canManageSync}
              title={!canManageSync ? ADMIN_ONLY_MESSAGE : undefined}
            >
              {isCleaningBackup ? "정리 중..." : "DB 백업 정리"}
            </Button>
          </CardFooter>
        </Card>

        <SyncDataToolsPanel
          status={status}
          canManageSync={canManageSync}
          timeZone={timeZone}
          dateTimeFormat={dateTimeFormat}
          onFeedback={onFeedback}
          authorizedFetch={authorizedFetch}
        />
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
            {backfillHistory.map((entry, index) => {
              const report = entry.report;
              return (
                <div
                  key={entry.id}
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
                      토론 {report.totals.discussions.toLocaleString()}
                    </span>
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
                            / 토론{" "}
                            {chunk.summary.counts.discussions.toLocaleString()}{" "}
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
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
