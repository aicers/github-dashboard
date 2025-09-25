import { Info } from "lucide-react";
import { useId } from "react";

import {
  changeColor,
  formatChange,
  formatMetricValue,
  type MetricFormat,
  type MetricImpact,
} from "@/components/dashboard/metric-utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ComparisonValue,
  DurationComparisonValue,
} from "@/lib/dashboard/types";

type MetricCardProps = {
  title: string;
  description?: string;
  metric: ComparisonValue | DurationComparisonValue;
  format: MetricFormat;
  impact?: MetricImpact;
  tooltip?: string;
};

export function MetricCard({
  title,
  description,
  metric,
  format,
  impact = "positive",
  tooltip,
}: MetricCardProps) {
  const tooltipId = useId();
  const valueMetric =
    format === "hours"
      ? {
          current: (metric as DurationComparisonValue).current,
          unit: (metric as DurationComparisonValue).unit,
        }
      : { current: metric.current };
  const valueLabel = formatMetricValue(valueMetric, format);
  const { changeLabel, percentLabel } = formatChange(metric, format);
  const changeClass = changeColor(impact, metric.absoluteChange);

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1 text-base font-medium">
          <span>{title}</span>
          {tooltip && (
            <button
              type="button"
              aria-describedby={tooltipId}
              className="group relative inline-flex cursor-help items-center text-muted-foreground focus:outline-none"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
              <span
                id={tooltipId}
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-20 w-48 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {tooltip}
              </span>
            </button>
          )}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs text-muted-foreground">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pb-4">
        <span className="text-3xl font-semibold">{valueLabel}</span>
        <span className={`text-xs font-medium ${changeClass}`}>
          {changeLabel} ({percentLabel})
        </span>
      </CardContent>
    </Card>
  );
}
