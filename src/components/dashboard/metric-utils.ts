const numberFormatter = new Intl.NumberFormat();

export function formatNumber(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatDuration(
  hours: number,
  unit: "hours" | "days" = "hours",
) {
  if (!Number.isFinite(hours)) {
    return "–";
  }

  if (unit === "days") {
    const days = hours / 24;
    return `${days.toFixed(days >= 10 ? 0 : 1)}일`;
  }

  if (Math.abs(hours) >= 48) {
    const days = hours / 24;
    return `${days.toFixed(days >= 10 ? 0 : 1)}일`;
  }

  return `${hours.toFixed(hours >= 10 ? 0 : 1)}시간`;
}

export type MetricImpact = "positive" | "negative" | "neutral";

export type MetricFormat =
  | "count"
  | "hours"
  | "ratio"
  | "percentage"
  | "multiplier";

export function formatMetricValue(
  metric: { current: number } & { unit?: "hours" | "days" },
  format: MetricFormat,
) {
  if (!Number.isFinite(metric.current)) {
    if (format === "hours") {
      return formatDuration(Number.NaN, metric.unit ?? "hours");
    }

    return "–";
  }

  if (format === "hours") {
    const hours = metric.current;
    return formatDuration(hours, metric.unit ?? "hours");
  }

  if (format === "percentage") {
    return `${(metric.current * 100).toFixed(1)}%`;
  }

  if (format === "ratio") {
    return metric.current.toFixed(2);
  }

  if (format === "multiplier") {
    return `${metric.current.toFixed(2)}x`;
  }

  return formatNumber(metric.current);
}

export function formatChange(
  metric: { absoluteChange: number; percentChange: number | null },
  format: MetricFormat,
) {
  const change = metric.absoluteChange;
  const percent = metric.percentChange;

  let changeLabel = "";
  if (format === "hours") {
    changeLabel = `${change >= 0 ? "+" : ""}${formatDuration(Math.abs(change), "hours")}`;
  } else if (format === "percentage") {
    const difference = change * 100;
    changeLabel = `${difference >= 0 ? "+" : ""}${difference.toFixed(1)}pt`;
  } else if (format === "ratio" || format === "multiplier") {
    changeLabel = `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
  } else {
    changeLabel = `${change >= 0 ? "+" : ""}${formatNumber(change)}`;
  }

  return {
    changeLabel,
    percentLabel:
      percent == null
        ? "–"
        : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`,
  };
}

export function changeColor(impact: MetricImpact, change: number) {
  if (impact === "neutral") {
    return "text-muted-foreground";
  }

  const isPositive = change >= 0;
  if (impact === "positive") {
    return isPositive ? "text-emerald-600" : "text-red-500";
  }

  return isPositive ? "text-red-500" : "text-emerald-600";
}
