import { XIcon } from "@primer/octicons-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import type { ActivityItem } from "@/lib/activity/types";
import { cn } from "@/lib/utils";
import { ISSUE_RELATION_BADGE_CLASS } from "./detail-shared";
import { type ActivityIconInfo, CATEGORY_LABELS } from "./shared";

export const DETAIL_PANEL_TRANSITION_MS = 300;

export type OverlayBadgeDescriptor = {
  key?: string;
  label: string;
  variant?: "default" | "manual" | "ai-soft" | "relation";
  tooltip?: string;
};

export type ActivityDetailOverlayProps = {
  item: ActivityItem;
  iconInfo: ActivityIconInfo;
  badges: Array<string | OverlayBadgeDescriptor>;
  badgeExtras?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

export function ActivityDetailOverlay({
  item,
  iconInfo,
  badges,
  badgeExtras,
  onClose,
  children,
}: ActivityDetailOverlayProps) {
  const headingId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleRequestClose = useCallback(() => {
    setIsVisible(false);
    if (closeTimerRef.current) {
      return;
    }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, DETAIL_PANEL_TRANSITION_MS);
  }, [onClose]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleRequestClose();
      }
    };

    document.addEventListener("keydown", handleKey);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [handleRequestClose]);

  const IconComponent = iconInfo.Icon;
  const referenceParts: string[] = [];
  if (item.repository?.nameWithOwner) {
    referenceParts.push(item.repository.nameWithOwner);
  }
  if (typeof item.number === "number") {
    referenceParts.push(`#${item.number}`);
  }
  const referenceLabel =
    referenceParts.length > 0 ? referenceParts.join("").toLowerCase() : null;
  const titleLabel = item.title?.trim().length
    ? item.title
    : `${CATEGORY_LABELS[item.type]} 상세`;
  const statusLabel = item.state ?? item.status ?? null;
  const labelBadges = Array.isArray(item.labels) ? item.labels : [];
  const normalizedBadges = badges.map((badge, index) => {
    if (typeof badge === "string") {
      return {
        key: `badge-${index}-${badge}`,
        label: badge,
        variant: "default" as const,
        tooltip: undefined,
      };
    }
    return {
      key:
        badge.key ??
        `badge-${index}-${badge.label.replace(/\s+/g, "-").toLowerCase()}`,
      label: badge.label,
      variant: badge.variant ?? "default",
      tooltip: badge.tooltip,
    };
  });

  return (
    <div className="fixed inset-0 z-60 flex justify-end">
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? "auto" : "none",
        }}
        aria-hidden="true"
        onClick={handleRequestClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={cn(
          "relative z-10 flex h-full w-full flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-out",
          "sm:mt-8 sm:mb-4 sm:mr-6 sm:h-auto sm:max-h-[92vh] sm:w-[96vw] sm:max-w-[96vw] sm:rounded-xl",
          "md:mt-10 md:mb-6 md:w-[96vw] md:max-w-[1400px]",
          isVisible ? "translate-x-0" : "translate-x-full",
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-col gap-4 border-b border-border/70 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-1 items-start gap-3">
            <span
              className={cn(
                "mt-1 inline-flex items-center justify-center leading-none",
                iconInfo.className,
              )}
            >
              <IconComponent className="h-5 w-5" />
              <span className="sr-only">{iconInfo.label}</span>
            </span>
            <div className="space-y-2">
              {referenceLabel ? (
                <div className="text-xs font-semibold tracking-wide text-[--activity-reference-link]">
                  {referenceLabel}
                </div>
              ) : null}
              <h3
                id={headingId}
                className="text-lg font-semibold leading-tight text-foreground"
              >
                {titleLabel}
              </h3>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground/80">
                {statusLabel ? <span>{statusLabel}</span> : null}
                {normalizedBadges.map((badge) => {
                  const variantClass =
                    badge.variant === "manual"
                      ? "border border-slate-300 bg-slate-100 text-slate-700"
                      : badge.variant === "ai-soft"
                        ? "border border-sky-300 bg-sky-50 text-sky-700 shadow-[0_0_0.65rem_rgba(56,189,248,0.25)]"
                        : badge.variant === "relation"
                          ? ISSUE_RELATION_BADGE_CLASS
                          : "bg-amber-100 text-amber-700";
                  return (
                    <span
                      key={badge.key}
                      className={cn(
                        "relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        variantClass,
                        badge.tooltip
                          ? "group cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          : "",
                      )}
                      tabIndex={badge.tooltip ? 0 : undefined}
                    >
                      {badge.label}
                      {badge.tooltip ? (
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-1/2 top-full z-20 w-60 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                          {badge.tooltip}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
                {badgeExtras ?? null}
                {labelBadges.map((label) => {
                  const display =
                    label.name ??
                    (typeof label.key === "string"
                      ? (label.key.split(":").pop() ?? label.key)
                      : "");
                  if (!display) {
                    return null;
                  }
                  return (
                    <span
                      key={`detail-label-${label.key}`}
                      className="rounded-md bg-muted px-2 py-0.5 text-foreground/85"
                    >
                      {display}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-start">
            {item.url ? (
              <Button asChild size="sm" variant="outline">
                <a href={item.url} target="_blank" rel="noreferrer">
                  GitHub에서 열기
                </a>
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              aria-label="닫기"
              onClick={handleRequestClose}
            >
              <XIcon />
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm sm:px-6">
          {children}
        </div>
      </div>
    </div>
  );
}
