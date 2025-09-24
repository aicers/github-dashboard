import { DateTime } from "luxon";

import type { WeekStart } from "@/lib/dashboard/types";

export type TimePresetKey =
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "custom";

export const PRESETS: Array<{ key: TimePresetKey; label: string }> = [
  { key: "last_30_days", label: "최근 30일" },
  { key: "this_week", label: "이번 주" },
  { key: "last_week", label: "지난 주" },
  { key: "this_month", label: "이번 달" },
  { key: "last_month", label: "지난 달" },
  { key: "this_quarter", label: "이번 분기" },
  { key: "custom", label: "사용자 지정" },
];

function toZonedDateTime(timeZone: string, reference?: Date) {
  if (reference) {
    return DateTime.fromJSDate(reference, { zone: timeZone });
  }

  return DateTime.now().setZone(timeZone);
}

function resolveWeekStart(date: DateTime, weekStart: WeekStart) {
  const weekday = date.weekday; // 1 (Mon) - 7 (Sun)
  const offset = weekStart === "monday" ? weekday - 1 : weekday % 7;
  return date.startOf("day").minus({ days: offset });
}

export function buildRangeFromPreset(
  preset: TimePresetKey,
  timeZone: string,
  weekStart: WeekStart = "monday",
  reference?: Date,
) {
  const now = toZonedDateTime(timeZone, reference);

  if (preset === "last_30_days") {
    const end = now.endOf("day");
    const start = end.minus({ days: 29 }).startOf("day");
    return { start: start.toUTC().toISO(), end: end.toUTC().toISO() };
  }

  if (preset === "this_week") {
    const start = resolveWeekStart(now, weekStart);
    const end = start.plus({ days: 6 }).endOf("day");
    return { start: start.toUTC().toISO(), end: end.toUTC().toISO() };
  }

  if (preset === "last_week") {
    const start = resolveWeekStart(now, weekStart).minus({ weeks: 1 });
    const end = start.plus({ days: 6 }).endOf("day");
    return { start: start.toUTC().toISO(), end: end.toUTC().toISO() };
  }

  if (preset === "this_month") {
    const start = now.startOf("month");
    const end = now.endOf("month");
    return { start: start.toUTC().toISO(), end: end.toUTC().toISO() };
  }

  if (preset === "last_month") {
    const lastMonth = now.minus({ months: 1 });
    const start = lastMonth.startOf("month");
    const end = lastMonth.endOf("month");
    return { start: start.toUTC().toISO(), end: end.toUTC().toISO() };
  }

  if (preset === "this_quarter") {
    const start = now.startOf("quarter");
    const end = now.endOf("quarter");
    return { start: start.toUTC().toISO(), end: end.toUTC().toISO() };
  }

  return null;
}

export function toDateInputValue(iso: string, timeZone: string) {
  const date = DateTime.fromISO(iso, { zone: "utc" }).setZone(timeZone);
  if (!date.isValid) {
    return "";
  }

  return date.toFormat("yyyy-LL-dd");
}

export function fromDateInputValue(
  value: string,
  timeZone: string,
  boundary: "start" | "end",
) {
  const base = DateTime.fromFormat(value, "yyyy-LL-dd", {
    zone: timeZone,
  });
  if (!base.isValid) {
    throw new Error("Invalid date input value.");
  }

  const zoned = boundary === "start" ? base.startOf("day") : base.endOf("day");
  return zoned.toUTC().toISO();
}
