const numberFormatter = new Intl.NumberFormat();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatCountValue(value: number): string {
  return numberFormatter.format(isFiniteNumber(value) ? value : 0);
}

export function formatDurationValue(
  hours: number | null | undefined,
  unit: "hours" | "days" = "hours",
): string {
  if (!isFiniteNumber(hours)) {
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
  if (!isFiniteNumber(metric.current)) {
    if (format === "hours") {
      return formatDurationValue(metric.current, metric.unit ?? "hours");
    }

    return "–";
  }

  if (format === "hours") {
    return formatDurationValue(metric.current, metric.unit ?? "hours");
  }

  if (format === "percentage") {
    return formatPercentageValue(metric.current);
  }

  if (format === "ratio") {
    return formatRatioValue(metric.current);
  }

  if (format === "multiplier") {
    return formatMultiplierValue(metric.current);
  }

  return formatCountValue(metric.current);
}

export function formatChangeForTest(
  metric: { absoluteChange: number; percentChange: number | null },
  format: "count" | "hours" | "percentage" | "ratio" | "multiplier",
  unit: "hours" | "days" = "hours",
): { changeLabel: string; percentLabel: string } {
  const change = metric.absoluteChange;
  const percent = metric.percentChange;

  let changeLabel: string;

  if (!isFiniteNumber(change)) {
    changeLabel = "–";
  } else if (format === "hours") {
    changeLabel = `${change >= 0 ? "+" : ""}${formatDurationValue(Math.abs(change), unit)}`;
  } else if (format === "percentage") {
    const difference = change * 100;
    changeLabel = `${difference >= 0 ? "+" : ""}${difference.toFixed(1)}pt`;
  } else if (format === "ratio" || format === "multiplier") {
    changeLabel = `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
  } else {
    changeLabel = `${change >= 0 ? "+" : ""}${formatCountValue(change)}`;
  }

  const percentLabel =
    percent == null ? "–" : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;

  return { changeLabel, percentLabel };
}
