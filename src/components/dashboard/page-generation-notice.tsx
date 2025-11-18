"use client";

import { TimestampBadge } from "@/components/dashboard/timestamp-badge";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { formatDateTimeDisplay } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";

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
  const generatedMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const latestSyncMs = latestSyncCompletedAt
    ? Date.parse(latestSyncCompletedAt)
    : Number.NaN;
  const isStale =
    Number.isFinite(generatedMs) &&
    Number.isFinite(latestSyncMs) &&
    generatedMs < latestSyncMs;

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
    if (formattedLatestSync) {
      return `Latest GitHub Sync ${formattedLatestSync} 이후에 새 데이터가 있어요. 필터를 적용해 최신 상태를 확인해 주세요.`;
    }
    return "Latest GitHub Sync 이후에 새 데이터가 있어요. 필터를 적용해 최신 상태를 확인해 주세요.";
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
