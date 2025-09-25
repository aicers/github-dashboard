import { Info } from "lucide-react";
import { type ReactNode, useId } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  type LabelProps,
  ResponsiveContainer,
  XAxis,
} from "recharts";

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
  PeriodKey,
} from "@/lib/dashboard/types";

const HISTORY_COLORS: Record<PeriodKey, string> = {
  previous2: "var(--color-chart-3)",
  previous: "var(--color-chart-2)",
  current: "var(--color-chart-1)",
};

type MetricCardProps = {
  title: string;
  description?: string;
  metric: ComparisonValue | DurationComparisonValue;
  format: MetricFormat;
  impact?: MetricImpact;
  tooltip?: string;
  history?: Array<{ period: PeriodKey; label: string; value: number | null }>;
};

export function MetricCard({
  title,
  description,
  metric,
  format,
  impact = "positive",
  tooltip,
  history,
}: MetricCardProps) {
  const tooltipId = useId();
  const metricUnit = "unit" in metric ? metric.unit : undefined;
  const valueMetric =
    metricUnit != null
      ? { current: metric.current, unit: metricUnit }
      : { current: metric.current };
  const valueLabel = formatMetricValue(valueMetric, format);
  const { changeLabel, percentLabel } = formatChange(metric, format);
  const changeClass = changeColor(impact, metric.absoluteChange);
  const historyData = (history ?? []).map((entry) => {
    const numericValue =
      entry.value == null || Number.isNaN(Number(entry.value))
        ? null
        : Number(entry.value);
    const period = entry.period ?? "current";
    const displayValue = formatMetricValue(
      {
        current: numericValue ?? Number.NaN,
        ...(metricUnit ? { unit: metricUnit } : {}),
      },
      format,
    );

    return {
      label: entry.label,
      period,
      rawValue: numericValue,
      value: numericValue ?? 0,
      displayValue,
      fill: HISTORY_COLORS[period] ?? HISTORY_COLORS.current,
    };
  });
  const hasHistory = historyData.some((entry) =>
    Number.isFinite(entry.rawValue),
  );

  const renderBarLabel = ({
    x,
    y,
    width,
    value,
    index,
  }: LabelProps): ReactNode => {
    if (typeof index !== "number") {
      return null;
    }

    const entry = historyData[index];
    if (!entry) {
      return null;
    }

    const label = typeof value === "string" ? value : String(value ?? "");
    if (!label) {
      return null;
    }

    const centerX = (x ?? 0) + (width ?? 0) / 2;
    const offsetY = (y ?? 0) - 6;

    return (
      <text
        x={centerX}
        y={offsetY}
        textAnchor="middle"
        fill="var(--foreground)"
        fontSize={11}
      >
        {label}
      </text>
    );
  };

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1 text-base font-medium">
          <span>{title}</span>
          {tooltip && (
            <button
              type="button"
              aria-describedby={tooltipId}
              aria-label={tooltip}
              className="group relative inline-flex cursor-help items-center bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
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
      <CardContent className="flex flex-col gap-2 pb-4">
        <span className="text-3xl font-semibold">{valueLabel}</span>
        <span className={`text-xs font-medium ${changeClass}`}>
          {changeLabel} ({percentLabel})
        </span>
        {hasHistory && (
          <div className="h-28 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={historyData}
                margin={{ top: 28, right: 12, left: -12, bottom: 0 }}
                barCategoryGap={12}
              >
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11 }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={36}>
                  {historyData.map((entry) => (
                    <Cell key={entry.period} fill={entry.fill} />
                  ))}
                  <LabelList
                    dataKey="displayValue"
                    position="top"
                    content={renderBarLabel}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
