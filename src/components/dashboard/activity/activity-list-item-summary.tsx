import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { type ActivityIconInfo, renderTitleWithInlineCode } from "./shared";

export type ActivityListItemSummaryProps = {
  iconInfo: ActivityIconInfo;
  referenceLabel?: string | null;
  referenceUrl?: string | null;
  title?: string | null;
  metadata?: ReactNode;
  className?: string;
};

export function ActivityListItemSummary({
  iconInfo,
  referenceLabel,
  referenceUrl,
  title,
  metadata,
  className,
}: ActivityListItemSummaryProps) {
  const IconComponent = iconInfo.Icon;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-center leading-none",
            iconInfo.className,
          )}
          title={iconInfo.label}
        >
          <IconComponent className="h-4 w-4" />
          <span className="sr-only">{iconInfo.label}</span>
        </span>
        {referenceLabel ? (
          referenceUrl ? (
            <a
              href={referenceUrl}
              target="_blank"
              rel="noreferrer"
              className="reference-link min-w-0"
            >
              {referenceLabel}
            </a>
          ) : (
            <span className="min-w-0 text-muted-foreground/80">
              {referenceLabel}
            </span>
          )
        ) : null}
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {renderTitleWithInlineCode(title ?? null)}
        </span>
      </div>
      {metadata ? metadata : null}
    </div>
  );
}
