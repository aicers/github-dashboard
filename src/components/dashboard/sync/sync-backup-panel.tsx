"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type DateTimeDisplayFormat,
  formatDateTime as formatDateTimeDisplay,
} from "@/lib/date-time-format";
import type { SyncStatus } from "@/lib/sync/service";

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
  reauthRequired?: boolean;
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

function formatBytes(size: number | null | undefined) {
  if (size === null || size === undefined || !Number.isFinite(size)) {
    return "-";
  }

  const absolute = Math.max(0, Number(size));
  if (absolute < 1024) {
    return `${Math.round(absolute).toLocaleString()} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = absolute / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
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

const backupTriggerLabels: Record<string, string> = {
  automatic: "자동",
  manual: "수동",
};

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 실행할 수 있습니다.";

type SyncBackupPanelProps = {
  status: SyncStatus;
  canManageSync: boolean;
  timeZone: string | null;
  dateTimeFormat: DateTimeDisplayFormat;
  onFeedback: (message: string | null) => void;
  onReauthRequired: () => void;
};

export function SyncBackupPanel({
  status,
  canManageSync,
  timeZone,
  dateTimeFormat,
  onFeedback,
  onReauthRequired,
}: SyncBackupPanelProps) {
  const router = useRouter();
  const backupInfo = status.backup;
  const backupSchedule = backupInfo.schedule;
  const backupDirectory = backupInfo.directory;
  const backupRetentionCount = backupInfo.retentionCount;
  const backupRecords = backupInfo.records ?? [];

  const [backupHour, setBackupHour] = useState(backupSchedule.hourLocal ?? 2);
  const [isSavingBackupSchedule, setIsSavingBackupSchedule] = useState(false);
  const [isRunningBackup, setIsRunningBackup] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(
    null,
  );
  const [isCleaningBackup, setIsCleaningBackup] = useState(false);

  const backupHourSelectId = useId();

  const backupHourOptions = useMemo(
    () => Array.from({ length: 24 }, (_value, hour) => hour),
    [],
  );

  useEffect(() => {
    setBackupHour(backupSchedule.hourLocal ?? 2);
  }, [backupSchedule.hourLocal]);

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

  function formatHourLabel(hour: number) {
    const normalized = Math.min(Math.max(Math.round(hour), 0), 23);
    return `${normalized.toString().padStart(2, "0")}:00`;
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

  async function handleRunBackup() {
    if (!canManageSync) {
      onFeedback(ADMIN_ONLY_MESSAGE);
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
      const data = await parseApiResponseWithReauth<unknown>(response);
      if (!data) {
        return;
      }
      if (!data.success) {
        throw new Error(data.message ?? "백업 실행에 실패했습니다.");
      }

      onFeedback(data.message ?? "백업을 완료했습니다.");
      router.refresh();
    } catch (error) {
      onFeedback(
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
      onFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    if (!Number.isFinite(backupHour) || backupHour < 0 || backupHour > 23) {
      onFeedback("백업 시각은 0시에서 23시 사이여야 합니다.");
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

      onFeedback("백업 실행 시간을 저장했습니다.");
      router.refresh();
    } catch (error) {
      onFeedback(
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
      onFeedback(ADMIN_ONLY_MESSAGE);
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
      const data = await parseApiResponseWithReauth<unknown>(response);
      if (!data) {
        return;
      }
      if (!data.success) {
        throw new Error(data.message ?? "백업 복구에 실패했습니다.");
      }

      onFeedback("백업 복구를 완료했습니다.");
      router.refresh();
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "백업 복구 중 오류가 발생했습니다.",
      );
    } finally {
      setRestoringBackupId(null);
    }
  }

  return (
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
                  isSavingBackupSchedule || isRunningBackup || !canManageSync
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
          {canManageSync ? (
            <div className="pt-2">
              <Button
                variant="outline"
                onClick={handleBackupCleanup}
                disabled={isCleaningBackup}
              >
                {isCleaningBackup ? "정리 중..." : "DB 백업 정리"}
              </Button>
            </div>
          ) : null}
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
                  backupStatusColors[record.status] ?? "text-muted-foreground";
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
                        생성 {formatRange(record.startedAt, record.completedAt)}
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
                        <span className={`${recordStatusClass} font-medium`}>
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
                        onClick={() => handleRestoreBackup(record.restoreKey)}
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
  );
}
