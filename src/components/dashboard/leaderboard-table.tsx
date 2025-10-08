import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatNumber } from "@/lib/dashboard/metric-formatters";
import type { LeaderboardEntry } from "@/lib/dashboard/types";

type LeaderboardTableProps = {
  title: string;
  entries: LeaderboardEntry[];
  unit?: string;
  secondaryUnit?: string;
  valueFormatter?: (value: number) => string;
  secondaryLabel?: string;
  tooltip?: string;
  headerActions?: ReactNode;
  valueTooltip?: (entry: LeaderboardEntry) => string | null;
};

export function LeaderboardTable({
  title,
  entries,
  unit,
  secondaryUnit,
  valueFormatter,
  secondaryLabel,
  tooltip,
  headerActions,
  valueTooltip,
}: LeaderboardTableProps) {
  const tooltipId = useId();
  const valueTooltipPrefix = useId();

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1 text-base font-medium">
          <span>{title}</span>
          {tooltip && (
            <button
              type="button"
              aria-describedby={tooltipId}
              aria-label={tooltip}
              className="group relative inline-flex cursor-help items-center bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              <span
                id={tooltipId}
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-20 w-52 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {tooltip}
              </span>
            </button>
          )}
        </CardTitle>
        {headerActions ? <CardAction>{headerActions}</CardAction> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>
        )}
        {entries.map((entry, index) => (
          <div key={entry.user.id} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-muted-foreground">{index + 1}</span>
            <div className="flex flex-col flex-1">
              <span className="font-medium">
                {entry.user.login ?? entry.user.name ?? entry.user.id}
              </span>
              {entry.user.name && entry.user.login && (
                <span className="text-xs text-muted-foreground whitespace-pre-line">
                  {entry.user.name}
                </span>
              )}
            </div>
            <div className="flex flex-col items-end text-right">
              <div className="flex items-center justify-end gap-1">
                <span className="font-semibold">
                  {valueFormatter
                    ? valueFormatter(entry.value)
                    : `${formatNumber(entry.value)}${unit ?? ""}`}
                </span>
                {(() => {
                  const valueTooltipText = valueTooltip?.(entry) ?? null;
                  if (!valueTooltipText) {
                    return null;
                  }
                  const entryTooltipId = `${valueTooltipPrefix}-${index}`;
                  return (
                    <button
                      type="button"
                      aria-describedby={entryTooltipId}
                      aria-label={valueTooltipText}
                      className="group relative inline-flex cursor-help items-center bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                    >
                      <Info className="h-3 w-3" aria-hidden="true" />
                      <span
                        id={entryTooltipId}
                        role="tooltip"
                        className="pointer-events-none absolute right-1/2 top-full z-20 w-48 translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                      >
                        {valueTooltipText}
                      </span>
                    </button>
                  );
                })()}
              </div>
              {(secondaryLabel && entry.secondaryValue != null) ||
              entry.details?.length ? (
                <div className="flex flex-col items-end text-right text-xs text-muted-foreground">
                  {(() => {
                    const lines: string[] = [];
                    const countParts: string[] = [];
                    const lineParts: string[] = [];
                    const secondaryUnitText = secondaryUnit ?? unit ?? "";

                    if (secondaryLabel && entry.secondaryValue != null) {
                      countParts.push(
                        `${secondaryLabel} ${formatNumber(entry.secondaryValue)}${secondaryUnitText}`,
                      );
                    }

                    entry.details?.forEach((detail) => {
                      const suffix = detail.suffix ?? "";
                      const prefix =
                        detail.sign === "positive"
                          ? "+"
                          : detail.sign === "negative"
                            ? "-"
                            : "";
                      const isLineDetail =
                        detail.label === "+" || detail.label === "-";
                      const numberText = `${prefix}${formatNumber(detail.value)}${suffix}`;
                      const display = isLineDetail
                        ? `${detail.label}${formatNumber(detail.value)}${suffix}`
                        : `${detail.label} ${numberText}`;
                      if (isLineDetail) {
                        lineParts.push(display);
                      } else {
                        countParts.push(display);
                      }
                    });

                    if (countParts.length > 0) {
                      lines.push(countParts.join(" · "));
                    }
                    if (lineParts.length > 0) {
                      lines.push(lineParts.join(" · "));
                    }

                    return lines.map((text) => <span key={text}>{text}</span>);
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
