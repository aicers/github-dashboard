"use client";

import { TimestampBadge } from "@/components/dashboard/timestamp-badge";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { formatDateTimeDisplay } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";

export function isPageDataStale(
  generatedAt?: string | null,
  latestSyncCompletedAt?: string | null,
) {
  if (!generatedAt || !latestSyncCompletedAt) {
    return false;
  }
  const generatedMs = Date.parse(generatedAt);
  const latestMs = Date.parse(latestSyncCompletedAt);
  if (!Number.isFinite(generatedMs) || !Number.isFinite(latestMs)) {
    return false;
  }
  return generatedMs < latestMs;
}

const DEFAULT_STALE_MESSAGE = "보이는 결과는 최신 데이터가 아닐 수 있습니다.";

type PageGenerationNoticeProps = {
  generatedAt?: string | null;
  latestSyncCompletedAt?: string | null;
  timezone?: string | null;
  dateTimeFormat?: DateTimeDisplayFormat | null;
  className?: string;
  align?: "start" | "end";
  label?: string;
  staleMessage?:
    | string
    | ((context: { formattedLatestSync: string | null }) => string);
};

export function PageGenerationNotice({
  generatedAt,
  latestSyncCompletedAt,
  timezone,
  dateTimeFormat,
  className,
  align = "end",
  label = "Page Generated:",
  staleMessage,
}: PageGenerationNoticeProps) {
  const trimmedTimezone = timezone?.trim() ?? "";
  const formattedLatestSync = latestSyncCompletedAt?.length
    ? formatDateTimeDisplay(latestSyncCompletedAt, {
        timeZone: trimmedTimezone || undefined,
        format: dateTimeFormat ?? undefined,
      })
    : null;
  const isStale = isPageDataStale(generatedAt, latestSyncCompletedAt);

  const resolvedMessage = (() => {
    if (!isStale) {
      return null;
    }
    if (typeof staleMessage === "function") {
      return staleMessage({ formattedLatestSync });
    }
    if (typeof staleMessage === "string") {
      return staleMessage;
    }
    return DEFAULT_STALE_MESSAGE;
  })();

  return (
    <div
      className={cn(
        "flex flex-col gap-1 text-xs text-muted-foreground",
        align === "end" ? "items-end" : "items-start",
        className,
      )}
    >
      <TimestampBadge
        label={label}
        timestamp={generatedAt}
        timezone={timezone ?? undefined}
        dateTimeFormat={dateTimeFormat}
        emphasis={isStale ? "warning" : "default"}
      />
      {resolvedMessage ? (
        <span className="text-xs text-amber-700">{resolvedMessage}</span>
      ) : null}
    </div>
  );
}
