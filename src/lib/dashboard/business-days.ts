import { env } from "@/lib/env";

type DateInput = string | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeHolidayDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const directMatch = /^\d{4}-\d{2}-\d{2}$/.exec(trimmed);
  if (directMatch) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getUTCFullYear()}-${`${parsed.getUTCMonth() + 1}`.padStart(2, "0")}-${`${parsed.getUTCDate()}`.padStart(2, "0")}`;
}

export function buildHolidaySet(dates: readonly string[]): Set<string> {
  const set = new Set<string>();
  dates.forEach((date) => {
    const normalized = normalizeHolidayDate(date);
    if (normalized) {
      set.add(normalized);
    }
  });
  return set;
}

export function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, "0")}-${`${date.getUTCDate()}`.padStart(2, "0")}`;
}

export function isBusinessDay(date: Date, holidays: Set<string> = HOLIDAY_SET) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }

  return !holidays.has(formatDateKey(date));
}

export function calculateBusinessHoursBetween(
  startInput: DateInput,
  endInput: DateInput,
  holidays: Set<string> = HOLIDAY_SET,
) {
  const start = toDate(startInput);
  const end = toDate(endInput);

  if (!start || !end) {
    return null;
  }

  if (end <= start) {
    return 0;
  }

  let cursor = start.getTime();
  const endMs = end.getTime();
  let totalMs = 0;

  while (cursor < endMs) {
    const cursorDate = new Date(cursor);
    const nextDayUtc = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate() + 1,
    );
    const segmentEnd = Math.min(nextDayUtc, endMs);
    if (isBusinessDay(cursorDate, holidays)) {
      totalMs += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }

  return totalMs / 3_600_000;
}

export function calculateBusinessDaysBetween(
  startInput: DateInput,
  endInput: DateInput,
  holidays: Set<string> = HOLIDAY_SET,
) {
  const hours = calculateBusinessHoursBetween(startInput, endInput, holidays);
  if (hours === null) {
    return null;
  }

  return hours / 24;
}

export const HOLIDAY_SET = buildHolidaySet(env.HOLIDAYS);

export function differenceInBusinessDays(
  value: DateInput,
  now: Date,
  holidays: Set<string> = HOLIDAY_SET,
) {
  const diff = calculateBusinessDaysBetween(value, now, holidays);
  if (diff === null) {
    return 0;
  }

  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return Math.floor(diff);
}

export function differenceInBusinessDaysOrNull(
  value: DateInput,
  now: Date,
  holidays: Set<string> = HOLIDAY_SET,
) {
  if (!value) {
    return null;
  }

  const diff = calculateBusinessDaysBetween(value, now, holidays);
  if (diff === null) {
    return null;
  }

  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return Math.floor(diff);
}
