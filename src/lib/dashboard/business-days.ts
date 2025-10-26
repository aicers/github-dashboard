import {
  buildHolidaySet,
  calculateBusinessDaysBetween as coreCalculateBusinessDaysBetween,
  calculateBusinessHoursBetween as coreCalculateBusinessHoursBetween,
  differenceInBusinessDays as coreDifferenceInBusinessDays,
  differenceInBusinessDaysOrNull as coreDifferenceInBusinessDaysOrNull,
  isBusinessDay as coreIsBusinessDay,
  type DateInput,
} from "@/lib/dashboard/business-days-core";
import { env } from "@/lib/env";

export {
  buildHolidaySet,
  type DateInput,
  formatDateKey,
  normalizeHolidayDate,
} from "@/lib/dashboard/business-days-core";

export const HOLIDAY_SET = buildHolidaySet(env.HOLIDAYS);

export function isBusinessDay(
  date: Date,
  holidays: ReadonlySet<string> = HOLIDAY_SET,
) {
  return coreIsBusinessDay(date, holidays);
}

export function calculateBusinessHoursBetween(
  startInput: DateInput,
  endInput: DateInput,
  holidays: ReadonlySet<string> = HOLIDAY_SET,
) {
  return coreCalculateBusinessHoursBetween(startInput, endInput, holidays);
}

export function calculateBusinessDaysBetween(
  startInput: DateInput,
  endInput: DateInput,
  holidays: ReadonlySet<string> = HOLIDAY_SET,
) {
  return coreCalculateBusinessDaysBetween(startInput, endInput, holidays);
}

export function differenceInBusinessDays(
  value: DateInput,
  now: Date,
  holidays: ReadonlySet<string> = HOLIDAY_SET,
) {
  return coreDifferenceInBusinessDays(value, now, holidays);
}

export function differenceInBusinessDaysOrNull(
  value: DateInput,
  now: Date,
  holidays: ReadonlySet<string> = HOLIDAY_SET,
) {
  return coreDifferenceInBusinessDaysOrNull(value, now, holidays);
}
