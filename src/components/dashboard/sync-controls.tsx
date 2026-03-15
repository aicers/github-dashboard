"use client";

import { useMemo, useState } from "react";

import { useAuthorizedFetch } from "@/components/dashboard/hooks/use-authorized-fetch";
import { ReauthModal } from "@/components/dashboard/reauth-modal";
import { SyncBackupPanel } from "@/components/dashboard/sync/sync-backup-panel";
import { SyncLogsPanel } from "@/components/dashboard/sync/sync-logs-panel";
import { SyncOverviewPanel } from "@/components/dashboard/sync/sync-overview-panel";
import { SyncSubTabs } from "@/components/dashboard/sync-subtabs";
import {
  type DateTimeDisplayFormat,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import type { SyncStatus } from "@/lib/sync/service";

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
  let value = absolute / 1024;
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

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 실행할 수 있습니다.";

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

export function SyncControls({
  status,
  isAdmin,
  timeZone: userTimeZone,
  dateTimeFormat: userDateTimeFormat,
  view = "overview",
  currentPathname,
}: SyncControlsProps) {
  const authorizedFetch = useAuthorizedFetch();
  const config = status.config;
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

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

  const canManageSync = isAdmin;
  const activePath = currentPathname ?? viewPathMap[view];
  const sectionId = sectionIdMap[view];

  const handleReauthConfirm = () => {
    const returnPath = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/auth/reauth?next=${encodeURIComponent(returnPath)}`;
  };

  return (
    <section id={sectionId} className="flex flex-col gap-4">
      <ReauthModal
        open={reauthOpen}
        onConfirm={handleReauthConfirm}
        onCancel={() => setReauthOpen(false)}
      />
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
        <SyncOverviewPanel
          status={status}
          canManageSync={canManageSync}
          timeZone={timeZone}
          dateTimeFormat={dateTimeFormat}
          onFeedback={setFeedback}
          onReauthRequired={() => setReauthOpen(true)}
          authorizedFetch={authorizedFetch}
        />
      )}

      {view === "backup" && (
        <SyncBackupPanel
          status={status}
          canManageSync={canManageSync}
          timeZone={timeZone}
          dateTimeFormat={dateTimeFormat}
          onFeedback={setFeedback}
          onReauthRequired={() => setReauthOpen(true)}
        />
      )}

      {view === "logs" && (
        <SyncLogsPanel
          status={status}
          timeZone={timeZone}
          dateTimeFormat={dateTimeFormat}
        />
      )}
    </section>
  );
}
