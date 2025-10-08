import { formatDateKey } from "@/lib/dashboard/business-days";

export type TrendEntry = Record<string, number> & { date: string };

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function normalizeTrendDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return formatDateKey(parsed);
}

export function buildDateKeys(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return [];
  }

  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const endUtc = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );

  const keys: string[] = [];
  for (let time = startUtc; time <= endUtc; time += DAY_IN_MS) {
    keys.push(formatDateKey(new Date(time)));
  }
  return keys;
}

export function mergeTrends(
  left: { date: string; value: number }[],
  right: { date: string; value: number }[],
  leftKey: string,
  rightKey: string,
) {
  const map = new Map<string, TrendEntry>();

  const ensureEntry = (rawDate: string): TrendEntry => {
    const normalizedDate = normalizeTrendDateKey(rawDate);
    let entry = map.get(normalizedDate);
    if (!entry) {
      entry = {
        date: normalizedDate,
        [leftKey]: 0,
        [rightKey]: 0,
      } as TrendEntry;
      map.set(normalizedDate, entry);
    }
    return entry;
  };

  left.forEach((point) => {
    const entry = ensureEntry(point.date);
    entry[leftKey] = point.value;
  });

  right.forEach((point) => {
    const entry = ensureEntry(point.date);
    entry[rightKey] = point.value;
  });

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function buildNetTrend(
  dateKeys: readonly string[],
  entries: TrendEntry[],
  positiveKey: string,
  negativeKey: string,
) {
  const normalizeNumeric = (value: unknown) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const map = new Map(
    entries.map((entry) => [normalizeTrendDateKey(entry.date), entry]),
  );

  return dateKeys.map((date) => {
    const entry = map.get(date);
    const positive = normalizeNumeric(entry?.[positiveKey]);
    const negative = normalizeNumeric(entry?.[negativeKey]);
    return {
      date,
      delta: positive - negative,
    };
  });
}
