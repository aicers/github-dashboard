import {
  type DateTimeDisplayFormat,
  isValidDateTimeDisplayFormat,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import { ensureSchema } from "@/lib/db";
import {
  getSyncConfig,
  getUserPreferences,
  upsertUserPreferences,
} from "@/lib/db/operations";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";

export type UserTimeSettings = {
  timezone: string;
  weekStart: "sunday" | "monday";
  dateTimeFormat: DateTimeDisplayFormat;
  holidayCalendarCode: HolidayCalendarCode;
};

function normalizeWeekStart(
  value: string | null | undefined,
): "sunday" | "monday" {
  return value === "sunday" ? "sunday" : "monday";
}

async function readFallbackSettings(): Promise<UserTimeSettings> {
  const config = await getSyncConfig();
  const timezone =
    typeof config?.timezone === "string" && config.timezone.trim().length
      ? config.timezone
      : "UTC";
  const weekStart = normalizeWeekStart(config?.week_start);
  const dateTimeFormat = normalizeDateTimeDisplayFormat(
    typeof config?.date_time_format === "string"
      ? config.date_time_format
      : null,
  );

  return {
    timezone,
    weekStart,
    dateTimeFormat,
    holidayCalendarCode: DEFAULT_HOLIDAY_CALENDAR,
  };
}

export async function readUserTimeSettings(
  userId?: string | null,
): Promise<UserTimeSettings> {
  await ensureSchema();

  const fallback = await readFallbackSettings();
  if (!userId) {
    return fallback;
  }

  const preferences = await getUserPreferences(userId);
  if (!preferences) {
    return fallback;
  }

  const timezone =
    typeof preferences.timezone === "string" &&
    preferences.timezone.trim().length
      ? preferences.timezone
      : fallback.timezone;
  const weekStart =
    preferences.weekStart === "sunday" || preferences.weekStart === "monday"
      ? preferences.weekStart
      : fallback.weekStart;
  const dateTimeFormat = normalizeDateTimeDisplayFormat(
    preferences.dateTimeFormat,
  );
  const holidayCalendarCode = preferences.holidayCalendarCode
    ? isHolidayCalendarCode(preferences.holidayCalendarCode)
      ? preferences.holidayCalendarCode
      : fallback.holidayCalendarCode
    : fallback.holidayCalendarCode;

  return { timezone, weekStart, dateTimeFormat, holidayCalendarCode };
}

export async function writeUserTimeSettings(
  userId: string,
  params: {
    timezone?: string;
    weekStart?: "sunday" | "monday";
    dateTimeFormat?: string;
    holidayCalendarCode?: string;
  },
) {
  await ensureSchema();

  const current = await readUserTimeSettings(userId);

  let timezone = current.timezone;
  if (params.timezone !== undefined) {
    const trimmed = params.timezone.trim();
    if (!trimmed) {
      throw new Error("Timezone cannot be empty.");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format();
    } catch (_error) {
      throw new Error("Invalid timezone identifier.");
    }
    timezone = trimmed;
  }

  let weekStart = current.weekStart;
  if (params.weekStart !== undefined) {
    const value = params.weekStart;
    if (value !== "sunday" && value !== "monday") {
      throw new Error("Week start must be either 'sunday' or 'monday'.");
    }
    weekStart = value;
  }

  let dateTimeFormat = current.dateTimeFormat;
  if (params.dateTimeFormat !== undefined) {
    const trimmed = params.dateTimeFormat.trim();
    if (!isValidDateTimeDisplayFormat(trimmed)) {
      throw new Error("Unsupported date-time display format.");
    }
    dateTimeFormat = trimmed;
  }

  let holidayCalendarCode = current.holidayCalendarCode;
  if (params.holidayCalendarCode !== undefined) {
    const trimmed = params.holidayCalendarCode.trim();
    if (!trimmed) {
      throw new Error("공휴일 달력을 선택해 주세요.");
    }
    if (!isHolidayCalendarCode(trimmed)) {
      throw new Error("지원하지 않는 공휴일 달력입니다.");
    }
    holidayCalendarCode = trimmed;
  }

  await upsertUserPreferences({
    userId,
    timezone,
    weekStart,
    dateTimeFormat,
    holidayCalendarCode,
  });
}
