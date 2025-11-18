import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { formatDateTimeDisplay } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";

type TimestampBadgeProps = {
  label: string;
  timestamp?: string | null;
  timezone?: string | null;
  dateTimeFormat?: DateTimeDisplayFormat | null;
  className?: string;
  emphasis?: "default" | "warning";
};

export function TimestampBadge({
  label,
  timestamp,
  timezone,
  dateTimeFormat,
  className,
  emphasis = "default",
}: TimestampBadgeProps) {
  const trimmedTimezone = timezone?.trim() ?? "";
  const formatted = timestamp?.length
    ? formatDateTimeDisplay(timestamp, {
        timeZone: trimmedTimezone || undefined,
        format: dateTimeFormat ?? undefined,
      })
    : null;
  const displayValue = formatted ?? "Not available";
  const badgeClass =
    emphasis === "warning"
      ? "bg-amber-100 text-amber-900"
      : "bg-slate-100/80 text-muted-foreground/80";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium tracking-wide",
        badgeClass,
        className,
      )}
    >
      {label}
      <span
        className="font-semibold text-foreground/80"
        title={trimmedTimezone || undefined}
      >
        {displayValue}
      </span>
    </span>
  );
}
