import {
  formatChange,
  formatDuration,
  formatMetricValue,
  formatNumber,
  type MetricFormat,
} from "@/lib/dashboard/metric-formatters";

export function formatCountValue(value: number): string {
  return formatNumber(value);
}

export function formatDurationValue(
  hours: number | null | undefined,
  unit: "hours" | "days" = "hours",
): string {
  const numeric = hours == null ? Number.NaN : Number(hours);
  return formatDuration(numeric, unit);
}

export function formatPercentageValue(value: number): string {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function formatRatioValue(value: number): string {
  return Number(value).toFixed(2);
}

export function formatMultiplierValue(value: number): string {
  return `${Number(value).toFixed(2)}x`;
}

export function formatMetricValueForTest(
  metric: { current: number } & { unit?: "hours" | "days" },
  format: "count" | "hours" | "ratio" | "percentage" | "multiplier",
): string {
  return formatMetricValue(metric, format as MetricFormat);
}

export function formatChangeForTest(
  metric: { absoluteChange: number; percentChange: number | null },
  format: "count" | "hours" | "percentage" | "ratio" | "multiplier",
  _unit: "hours" | "days" = "hours",
): { changeLabel: string; percentLabel: string } {
  void _unit;
  return formatChange(metric, format as MetricFormat);
}

export function formatMetricSnapshotForTest(
  metric: {
    current: number;
    absoluteChange: number;
    percentChange: number | null;
  } & {
    unit?: "hours" | "days";
  },
  format: MetricFormat,
): { valueLabel: string; changeLabel: string; percentLabel: string } {
  const valueLabel = formatMetricValue(
    { current: metric.current, unit: metric.unit },
    format,
  );
  const { changeLabel, percentLabel } = formatChange(
    {
      absoluteChange: metric.absoluteChange,
      percentChange: metric.percentChange,
    },
    format,
  );
  return { valueLabel, changeLabel, percentLabel };
}
