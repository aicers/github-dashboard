import {
  calculateBusinessHoursBetween,
  formatDateKey,
  HOLIDAY_SET,
} from "@/lib/dashboard/business-days";
import type {
  ComparisonBreakdownEntry,
  ComparisonValue,
  DurationComparisonValue,
  MetricHistoryEntry,
  PeriodKey,
} from "@/lib/dashboard/types";

export const DEPENDABOT_FILTER =
  "NOT (COALESCE(LOWER(u.login), '') LIKE 'dependabot%' OR COALESCE(LOWER(u.login), '') = 'app/dependabot')";

export function toIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return date.toISOString();
}

export function differenceInDays(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const msPerDay = 86_400_000;
  return Math.max(1, Math.floor((end - start) / msPerDay) + 1);
}

export function subtractDuration(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);
  return {
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
  };
}

export function calculatePercentChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }

  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return ((current - previous) / previous) * 100;
}

export function buildComparison(
  current: number,
  previous: number,
  breakdown?: ComparisonBreakdownEntry[],
): ComparisonValue {
  const currentValue = Number(current ?? 0);
  const previousValue = Number(previous ?? 0);
  return {
    current: currentValue,
    previous: previousValue,
    absoluteChange: currentValue - previousValue,
    percentChange: calculatePercentChange(currentValue, previousValue),
    breakdown: breakdown?.length ? breakdown : undefined,
  };
}

export function buildDurationComparison(
  currentHours: number | null,
  previousHours: number | null,
  unit: "hours" | "days",
): DurationComparisonValue {
  const normalize = (value: number | string | null | undefined) => {
    if (value === null || value === undefined) {
      return Number.NaN;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
  };

  const current = normalize(currentHours);
  const previous = normalize(previousHours);
  return {
    current,
    previous,
    absoluteChange: current - previous,
    percentChange: calculatePercentChange(current, previous),
    unit,
  };
}

export function buildRatioComparison(
  current: number | null,
  previous: number | null,
): ComparisonValue {
  return buildComparison(current ?? 0, previous ?? 0);
}

export const HISTORY_PERIODS: PeriodKey[] = [
  "previous4",
  "previous3",
  "previous2",
  "previous",
  "current",
];

export function normalizeHistoryValue(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildHistorySeries(
  values: Array<number | null | undefined>,
): MetricHistoryEntry[] {
  return HISTORY_PERIODS.map((period, index) => ({
    period,
    value: normalizeHistoryValue(values[index]),
  }));
}

export function roundToOneDecimal(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.round(numeric * 10) / 10;
}

export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export function averageBusinessResponseHours(
  rows: { requestedAt: string; respondedAt: string | null }[],
  holidays: Set<string>,
) {
  const values: number[] = [];
  rows.forEach((row) => {
    const hours = calculateBusinessHoursBetween(
      row.requestedAt,
      row.respondedAt,
      holidays,
    );
    if (hours !== null && Number.isFinite(hours)) {
      values.push(hours);
    }
  });

  if (!values.length) {
    return null;
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

export type RangeContext = {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  previous2Start: string;
  previous2End: string;
  previous3Start: string;
  previous3End: string;
  previous4Start: string;
  previous4End: string;
  intervalDays: number;
};

export function resolveRange({
  start,
  end,
}: {
  start: string;
  end: string;
}): RangeContext {
  const sanitizedStart = toIso(start);
  const sanitizedEnd = toIso(end);
  const { previousStart, previousEnd } = subtractDuration(
    sanitizedStart,
    sanitizedEnd,
  );
  const { previousStart: previous2Start, previousEnd: previous2End } =
    subtractDuration(previousStart, previousEnd);
  const { previousStart: previous3Start, previousEnd: previous3End } =
    subtractDuration(previous2Start, previous2End);
  const { previousStart: previous4Start, previousEnd: previous4End } =
    subtractDuration(previous3Start, previous3End);
  const intervalDays = differenceInDays(sanitizedStart, sanitizedEnd);
  return {
    start: sanitizedStart,
    end: sanitizedEnd,
    previousStart,
    previousEnd,
    previous2Start,
    previous2End,
    previous3Start,
    previous3End,
    previous4Start,
    previous4End,
    intervalDays,
  };
}

export { formatDateKey, HOLIDAY_SET };
