import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { type ActivityIconInfo, renderTitleWithInlineCode } from "./shared";

export type ActivityListItemSummaryProps = {
  iconInfo: ActivityIconInfo;
  referenceLabel?: string | null;
  referenceUrl?: string | null;
  title?: string | null;
  metadata?: ReactNode;
};

export function ActivityListItemSummary({
  iconInfo,
  referenceLabel,
  referenceUrl,
  title,
  metadata,
}: ActivityListItemSummaryProps) {
  const IconComponent = iconInfo.Icon;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <span
          className={cn(
            "inline-flex items-center justify-center leading-none",
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
              className="reference-link"
            >
              {referenceLabel}
            </a>
          ) : (
            <span className="text-muted-foreground/80">{referenceLabel}</span>
          )
        ) : null}
        <span className="font-semibold text-foreground truncate">
          {renderTitleWithInlineCode(title ?? null)}
        </span>
      </div>
      {metadata ? metadata : null}
    </div>
  );
}
