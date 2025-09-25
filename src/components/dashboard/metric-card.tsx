import { Info } from "lucide-react";
import { type ReactElement, useId } from "react";
import {
  type DotProps,
  LabelList,
  type LabelProps,
  Line,
  LineChart,
  type LineProps,
  ResponsiveContainer,
  XAxis,
  YAxis,
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
  previous4: "var(--color-chart-5)",
  previous3: "var(--color-chart-4)",
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
      value: numericValue,
      displayValue,
      fill: HISTORY_COLORS[period] ?? HISTORY_COLORS.current,
    };
  });
  const hasHistory = historyData.some((entry) =>
    Number.isFinite(entry.rawValue),
  );

  type ChartContentRenderer<Props> = (props: Props) => ReactElement | null;

  const renderDot: ChartContentRenderer<DotProps> = (props) => {
    const entry = (
      props as DotProps & {
        payload?: (typeof historyData)[number];
      }
    ).payload;
    const cx =
      typeof props.cx === "number" ? props.cx : Number(props.cx ?? Number.NaN);
    const cy =
      typeof props.cy === "number" ? props.cy : Number(props.cy ?? Number.NaN);
    const shouldHide =
      !entry ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      entry.rawValue == null;

    return (
      <circle
        cx={Number.isFinite(cx) ? cx : 0}
        cy={Number.isFinite(cy) ? cy : 0}
        r={shouldHide ? 0 : 5}
        fill={entry?.fill ?? "var(--color-chart-1)"}
        stroke={shouldHide ? "transparent" : "var(--background)"}
        strokeWidth={shouldHide ? 0 : 2}
      />
    );
  };

  const renderPointLabel: ChartContentRenderer<LabelProps> = (props) => {
    const entry = (
      props as LabelProps & {
        payload?: (typeof historyData)[number];
      }
    ).payload;
    if (!entry) {
      return null;
    }

    const label =
      typeof props.value === "string" ? props.value : String(props.value ?? "");
    if (!label) {
      return null;
    }

    const numericX =
      typeof props.x === "number" ? props.x : Number(props.x ?? 0);
    const numericY =
      typeof props.y === "number" ? props.y : Number(props.y ?? 0);
    const offsetY = numericY - 8;

    return (
      <text
        x={numericX}
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
          <div className="h-32 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={historyData}
                margin={{ top: 28, right: 16, left: 16, bottom: 0 }}
              >
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis hide domain={["auto", "auto"]} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2}
                  dot={renderDot as LineProps["dot"]}
                  connectNulls={false}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="displayValue"
                    position="top"
                    content={renderPointLabel}
                  />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
