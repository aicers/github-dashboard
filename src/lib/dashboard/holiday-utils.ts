import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";

/**
 * Normalises the raw `org_holiday_calendar_codes` config field into a typed
 * array of `HolidayCalendarCode` values.
 *
 * Falls back to `[DEFAULT_HOLIDAY_CALENDAR]` when the config is absent,
 * empty, or contains no recognisable codes.
 */
export function normalizeOrganizationHolidayCodes(
  config: unknown,
): HolidayCalendarCode[] {
  if (
    !config ||
    !(config as { org_holiday_calendar_codes?: unknown })
      .org_holiday_calendar_codes
  ) {
    return [DEFAULT_HOLIDAY_CALENDAR];
  }

  const raw = (config as { org_holiday_calendar_codes?: unknown })
    .org_holiday_calendar_codes;
  if (!Array.isArray(raw)) {
    return [DEFAULT_HOLIDAY_CALENDAR];
  }

  const codes = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && isHolidayCalendarCode(value));

  if (!codes.length) {
    return [DEFAULT_HOLIDAY_CALENDAR];
  }

  return Array.from(new Set(codes)) as HolidayCalendarCode[];
}
