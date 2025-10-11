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

import { type ActivityIconInfo, CATEGORY_LABELS } from "./shared";

export const DETAIL_PANEL_TRANSITION_MS = 300;

export type ActivityDetailOverlayProps = {
  item: ActivityItem;
  iconInfo: ActivityIconInfo;
  badges: string[];
  onClose: () => void;
  children: ReactNode;
};

export function ActivityDetailOverlay({
  item,
  iconInfo,
  badges,
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
    referenceParts.length > 0 ? referenceParts.join("") : null;
  const titleLabel = item.title?.trim().length
    ? item.title
    : `${CATEGORY_LABELS[item.type]} 상세`;
  const statusLabel = item.state ?? item.status ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
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
          "sm:mt-12 sm:mb-6 sm:mr-6 sm:h-auto sm:max-h-[85vh] sm:w-[90vw] sm:max-w-[90vw] sm:rounded-xl",
          "md:mt-16 md:mb-8",
          isVisible ? "translate-x-0" : "translate-x-full",
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-col gap-4 border-b border-border/70 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-1 items-start gap-3">
            <span
              className={cn(
                "mt-1 inline-flex items-center justify-center rounded-full border border-border/60 bg-background p-2",
                iconInfo.className,
              )}
            >
              <IconComponent className="h-5 w-5" />
              <span className="sr-only">{iconInfo.label}</span>
            </span>
            <div className="space-y-2">
              {referenceLabel ? (
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
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
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700"
                  >
                    {badge}
                  </span>
                ))}
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
