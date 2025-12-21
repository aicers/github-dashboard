import type { DateInput } from "@/lib/dashboard/business-days-core";

const EMPTY_HOLIDAY_SET: ReadonlySet<string> = new Set();

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 (Sun) - 6 (Sat)
};

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

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function weekdayToIndex(value: string) {
  switch (value) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      return null;
  }
}

function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = getZonedFormatter(timeZone);
  const parts = formatter.formatToParts(date);

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let weekday: number | null = null;

  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = Number.parseInt(part.value, 10);
        break;
      case "month":
        month = Number.parseInt(part.value, 10);
        break;
      case "day":
        day = Number.parseInt(part.value, 10);
        break;
      case "hour":
        hour = Number.parseInt(part.value, 10);
        break;
      case "minute":
        minute = Number.parseInt(part.value, 10);
        break;
      case "second":
        second = Number.parseInt(part.value, 10);
        break;
      case "weekday":
        weekday = weekdayToIndex(part.value);
        break;
      default:
        break;
    }
  }

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    throw new Error("Failed to resolve local date parts.");
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: weekday ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function formatDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${`${parts.month}`.padStart(2, "0")}-${`${parts.day}`.padStart(2, "0")}`;
}

export function isBusinessDayInTimeZone(
  date: Date,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
  timeZone: string,
) {
  const parts = getZonedParts(date, timeZone);
  if (parts.weekday === 0 || parts.weekday === 6) {
    return false;
  }

  const dateKey = `${parts.year}-${`${parts.month}`.padStart(2, "0")}-${`${parts.day}`.padStart(2, "0")}`;
  return !holidays.has(dateKey);
}

function getTimeZoneOffsetMs(dateUtcMs: number, timeZone: string) {
  const parts = getZonedParts(new Date(dateUtcMs), timeZone);
  const asIfUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtcMs - dateUtcMs;
}

function zonedDateTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getTimeZoneOffsetMs(guess, timeZone);
  const candidate1 = guess - offset1;
  const offset2 = getTimeZoneOffsetMs(candidate1, timeZone);
  return guess - offset2;
}

function addDaysUtc(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
) {
  const next = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function calculateBusinessHoursBetweenInTimeZone(
  startInput: DateInput,
  endInput: DateInput,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
  timeZone: string,
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
    const parts = getZonedParts(cursorDate, timeZone);
    const nextLocalDate = addDaysUtc(parts.year, parts.month, parts.day, 1);
    const nextMidnightUtc = zonedDateTimeToUtcMs(
      nextLocalDate.year,
      nextLocalDate.month,
      nextLocalDate.day,
      0,
      0,
      0,
      timeZone,
    );

    const segmentEnd = Math.min(nextMidnightUtc, endMs);
    if (isBusinessDayInTimeZone(cursorDate, holidays, timeZone)) {
      totalMs += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }

  return totalMs / 3_600_000;
}

export function differenceInBusinessDaysInTimeZone(
  value: DateInput,
  now: Date,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
  timeZone: string,
) {
  const start = toDate(value);
  if (!start) {
    return 0;
  }

  if (now.getTime() <= start.getTime()) {
    return 0;
  }

  const startParts = getZonedParts(start, timeZone);
  const endParts = getZonedParts(now, timeZone);

  const endDate = {
    year: endParts.year,
    month: endParts.month,
    day: endParts.day,
  };

  let cursor = addDaysUtc(startParts.year, startParts.month, startParts.day, 1);
  let total = 0;

  while (true) {
    if (
      cursor.year > endDate.year ||
      (cursor.year === endDate.year && cursor.month > endDate.month) ||
      (cursor.year === endDate.year &&
        cursor.month === endDate.month &&
        cursor.day >= endDate.day)
    ) {
      break;
    }

    const weekday = new Date(
      Date.UTC(cursor.year, cursor.month - 1, cursor.day),
    ).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const dateKey = `${cursor.year}-${`${cursor.month}`.padStart(2, "0")}-${`${cursor.day}`.padStart(2, "0")}`;
      if (!holidays.has(dateKey)) {
        total += 1;
      }
    }

    cursor = addDaysUtc(cursor.year, cursor.month, cursor.day, 1);
  }

  return total;
}

export function hasBusinessDaysElapsedInTimeZone(
  startInput: DateInput,
  now: Date,
  businessDays: number,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
  timeZone: string,
) {
  if (!Number.isFinite(businessDays) || businessDays <= 0) {
    return true;
  }

  const start = toDate(startInput);
  if (!start) {
    return false;
  }

  const endMs = now.getTime();
  if (endMs <= start.getTime()) {
    return false;
  }

  const thresholdMs = businessDays * 24 * 3_600_000;
  let cursor = start.getTime();
  let totalMs = 0;

  while (cursor < endMs && totalMs < thresholdMs) {
    const cursorDate = new Date(cursor);
    const parts = getZonedParts(cursorDate, timeZone);
    const nextLocalDate = addDaysUtc(parts.year, parts.month, parts.day, 1);
    const nextMidnightUtc = zonedDateTimeToUtcMs(
      nextLocalDate.year,
      nextLocalDate.month,
      nextLocalDate.day,
      0,
      0,
      0,
      timeZone,
    );
    const segmentEnd = Math.min(nextMidnightUtc, endMs);
    if (isBusinessDayInTimeZone(cursorDate, holidays, timeZone)) {
      totalMs += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }

  return totalMs >= thresholdMs;
}
