import {
  calculateBusinessDaysBetween as coreCalculateBusinessDaysBetween,
  calculateBusinessHoursBetween as coreCalculateBusinessHoursBetween,
  differenceInBusinessDays as coreDifferenceInBusinessDays,
  differenceInBusinessDaysOrNull as coreDifferenceInBusinessDaysOrNull,
  isBusinessDay as coreIsBusinessDay,
  type DateInput,
} from "@/lib/dashboard/business-days-core";
import type { HolidayCalendarCode } from "@/lib/holidays/constants";
import {
  invalidateHolidayCache as invalidateHolidayCacheFromService,
  loadHolidaySet as loadHolidaySetFromService,
} from "@/lib/holidays/service";

export {
  buildHolidaySet,
  type DateInput,
  formatDateKey,
  normalizeHolidayDate,
} from "@/lib/dashboard/business-days-core";

export const EMPTY_HOLIDAY_SET: ReadonlySet<string> = new Set();

export function invalidateHolidayCache(
  calendarCode?: HolidayCalendarCode,
): void {
  invalidateHolidayCacheFromService(calendarCode);
}

export function loadHolidaySet(
  calendarCode: HolidayCalendarCode,
): Promise<ReadonlySet<string>> {
  return loadHolidaySetFromService(calendarCode);
}

export function isBusinessDay(
  date: Date,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
) {
  return coreIsBusinessDay(date, holidays);
}

export function calculateBusinessHoursBetween(
  startInput: DateInput,
  endInput: DateInput,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
) {
  return coreCalculateBusinessHoursBetween(startInput, endInput, holidays);
}

export function calculateBusinessDaysBetween(
  startInput: DateInput,
  endInput: DateInput,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
) {
  return coreCalculateBusinessDaysBetween(startInput, endInput, holidays);
}

export function differenceInBusinessDays(
  value: DateInput,
  now: Date,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
) {
  return coreDifferenceInBusinessDays(value, now, holidays);
}

export function differenceInBusinessDaysOrNull(
  value: DateInput,
  now: Date,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAY_SET,
) {
  return coreDifferenceInBusinessDaysOrNull(value, now, holidays);
}
