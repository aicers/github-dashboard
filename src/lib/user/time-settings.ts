import {
  type DateTimeDisplayFormat,
  isValidDateTimeDisplayFormat,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import { ensureSchema } from "@/lib/db";
import {
  createUserPersonalHoliday,
  deleteUserPersonalHoliday,
  getSyncConfig,
  getUserPreferences,
  listUserPersonalHolidays,
  type UserPersonalHolidayRow,
  updateUserPersonalHoliday,
  upsertUserPreferences,
} from "@/lib/db/operations";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";

export type PersonalHoliday = {
  id: number;
  label: string | null;
  startDate: string;
  endDate: string;
};

export type UserTimeSettings = {
  timezone: string;
  weekStart: "sunday" | "monday";
  dateTimeFormat: DateTimeDisplayFormat;
  holidayCalendarCodes: HolidayCalendarCode[];
  organizationHolidayCalendarCodes: HolidayCalendarCode[];
  personalHolidays: PersonalHoliday[];
  activityRowsPerPage: number;
};

function normalizeWeekStart(
  value: string | null | undefined,
): "sunday" | "monday" {
  return value === "sunday" ? "sunday" : "monday";
}

function normalizeHolidayCodes(
  values: readonly (string | null | undefined)[] | null | undefined,
  fallback: HolidayCalendarCode[],
): HolidayCalendarCode[] {
  const codes: HolidayCalendarCode[] = [];
  const seen = new Set<string>();

  if (Array.isArray(values)) {
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed) || !isHolidayCalendarCode(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      codes.push(trimmed);
    }
  }

  if (codes.length > 0) {
    return codes;
  }

  const fallbackCodes: HolidayCalendarCode[] = [];
  for (const value of fallback) {
    if (!seen.has(value)) {
      seen.add(value);
      fallbackCodes.push(value);
    }
  }
  if (fallbackCodes.length > 0) {
    return fallbackCodes;
  }

  return [DEFAULT_HOLIDAY_CALENDAR];
}

function toIsoDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("유효한 날짜를 입력해 주세요.");
  }
  return trimmed;
}

function normalizePersonalHolidayLabel(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 120) {
    throw new Error("이름은 120자 이하여야 합니다.");
  }
  return trimmed;
}

function mapPersonalHolidayRow(row: UserPersonalHolidayRow): PersonalHoliday {
  const startDate = row.startDate.slice(0, 10);
  const endDate = row.endDate.slice(0, 10);
  return {
    id: row.id,
    label: row.label ?? null,
    startDate,
    endDate,
  };
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
  const organizationHolidayCalendarCodes = normalizeHolidayCodes(
    Array.isArray(config?.org_holiday_calendar_codes)
      ? (config.org_holiday_calendar_codes as (string | null | undefined)[])
      : null,
    [DEFAULT_HOLIDAY_CALENDAR],
  );

  return {
    timezone,
    weekStart,
    dateTimeFormat,
    holidayCalendarCodes: organizationHolidayCalendarCodes,
    organizationHolidayCalendarCodes,
    personalHolidays: [],
    activityRowsPerPage: 25,
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

  const [preferences, personalHolidayRows] = await Promise.all([
    getUserPreferences(userId),
    listUserPersonalHolidays(userId),
  ]);

  if (!preferences) {
    return {
      ...fallback,
      personalHolidays: personalHolidayRows.map(mapPersonalHolidayRow),
    };
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

  const holidayCalendarCodes = normalizeHolidayCodes(
    preferences.holidayCalendarCodes,
    fallback.organizationHolidayCalendarCodes,
  );

  const personalHolidays = personalHolidayRows.map(mapPersonalHolidayRow);

  return {
    timezone,
    weekStart,
    dateTimeFormat,
    holidayCalendarCodes,
    organizationHolidayCalendarCodes: fallback.organizationHolidayCalendarCodes,
    personalHolidays,
    activityRowsPerPage:
      typeof preferences.activityRowsPerPage === "number" &&
      Number.isFinite(preferences.activityRowsPerPage) &&
      preferences.activityRowsPerPage > 0 &&
      preferences.activityRowsPerPage <= 100
        ? Math.floor(preferences.activityRowsPerPage)
        : fallback.activityRowsPerPage,
  };
}

export async function writeUserTimeSettings(
  userId: string,
  params: {
    timezone?: string;
    weekStart?: "sunday" | "monday";
    dateTimeFormat?: string;
    holidayCalendarCode?: string;
    holidayCalendarCodes?: string[];
    activityRowsPerPage?: number;
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

  let holidayCalendarCodes = current.holidayCalendarCodes;
  if (params.holidayCalendarCodes !== undefined) {
    if (!Array.isArray(params.holidayCalendarCodes)) {
      throw new Error("공휴일 달력 선택이 올바르지 않습니다.");
    }
    const selected: HolidayCalendarCode[] = [];
    const seen = new Set<string>();
    for (const value of params.holidayCalendarCodes) {
      if (typeof value !== "string") {
        throw new Error("지원하지 않는 공휴일 달력입니다.");
      }
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      if (!isHolidayCalendarCode(trimmed)) {
        throw new Error("지원하지 않는 공휴일 달력입니다.");
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        selected.push(trimmed);
      }
    }
    holidayCalendarCodes =
      selected.length > 0 ? selected : current.organizationHolidayCalendarCodes;
  } else if (params.holidayCalendarCode !== undefined) {
    const trimmed = params.holidayCalendarCode.trim();
    if (!trimmed) {
      throw new Error("공휴일 달력을 선택해 주세요.");
    }
    if (!isHolidayCalendarCode(trimmed)) {
      throw new Error("지원하지 않는 공휴일 달력입니다.");
    }
    holidayCalendarCodes = [trimmed];
  }
  let activityRowsPerPage = current.activityRowsPerPage;
  if (params.activityRowsPerPage !== undefined) {
    if (
      !Number.isFinite(params.activityRowsPerPage) ||
      params.activityRowsPerPage <= 0
    ) {
      throw new Error("Activity rows per page must be a positive number.");
    }
    const normalized = Math.floor(params.activityRowsPerPage);
    if (normalized < 1 || normalized > 100) {
      throw new Error("Activity rows per page must be between 1 and 100.");
    }
    activityRowsPerPage = normalized;
  }

  await upsertUserPreferences({
    userId,
    timezone,
    weekStart,
    dateTimeFormat,
    holidayCalendarCodes,
    activityRowsPerPage,
  });
}

export type PersonalHolidayInput = {
  label?: string | null;
  startDate: string;
  endDate?: string | null;
};

function normalizePersonalHolidayInput(input: PersonalHolidayInput): {
  label: string | null;
  startDate: string;
  endDate: string;
} {
  if (!input.startDate) {
    throw new Error("시작일을 입력해 주세요.");
  }

  const startDate = toIsoDate(input.startDate);
  const endSource = input.endDate ?? input.startDate;
  if (!endSource) {
    throw new Error("종료일을 입력해 주세요.");
  }
  const endDate = toIsoDate(endSource);

  if (endDate < startDate) {
    throw new Error("종료일은 시작일 이후여야 합니다.");
  }

  const label = normalizePersonalHolidayLabel(input.label);

  return { label, startDate, endDate };
}

export async function addPersonalHoliday(
  userId: string,
  input: PersonalHolidayInput,
): Promise<PersonalHoliday> {
  await ensureSchema();
  const normalized = normalizePersonalHolidayInput(input);
  const row = await createUserPersonalHoliday({
    userId,
    label: normalized.label,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  });
  return mapPersonalHolidayRow(row);
}

export async function updatePersonalHoliday(
  userId: string,
  id: number,
  input: PersonalHolidayInput,
): Promise<PersonalHoliday> {
  await ensureSchema();
  const normalized = normalizePersonalHolidayInput(input);
  const row = await updateUserPersonalHoliday({
    id,
    userId,
    label: normalized.label,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  });
  if (!row) {
    throw new Error("개인 휴일을 찾을 수 없습니다.");
  }
  return mapPersonalHolidayRow(row);
}

export async function removePersonalHoliday(
  userId: string,
  id: number,
): Promise<void> {
  await ensureSchema();
  const removed = await deleteUserPersonalHoliday({ id, userId });
  if (!removed) {
    throw new Error("개인 휴일을 찾을 수 없습니다.");
  }
}

export function expandPersonalHolidayDates(
  entries: PersonalHoliday[],
): Set<string> {
  const dates = new Set<string>();
  for (const entry of entries) {
    const start = new Date(`${entry.startDate}T00:00:00Z`);
    const end = new Date(`${entry.endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      continue;
    }

    for (
      let time = start.getTime();
      time <= end.getTime();
      time += 86_400_000
    ) {
      const current = new Date(time);
      const isoDate = `${current.getUTCFullYear()}-${`${current.getUTCMonth() + 1}`.padStart(2, "0")}-${`${current.getUTCDate()}`.padStart(2, "0")}`;
      dates.add(isoDate);
    }
  }

  return dates;
}
