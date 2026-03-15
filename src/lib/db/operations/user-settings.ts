import { query } from "@/lib/db/client";
import {
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";

import {
  buildStoredUserData,
  parseStoredUserData,
  type StoredUserProfile,
} from "./types";

export type UserPreferencesRow = {
  userId: string;
  timezone: string;
  weekStart: "sunday" | "monday";
  dateTimeFormat: string;
  holidayCalendarCode: HolidayCalendarCode | null;
  holidayCalendarCodes: HolidayCalendarCode[];
  activityRowsPerPage: number;
};

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesRow | null> {
  const result = await query<{
    user_id: string;
    timezone: string;
    week_start: string;
    date_time_format: string;
    holiday_calendar_code: HolidayCalendarCode | null;
    holiday_calendar_codes: HolidayCalendarCode[] | null;
    activity_rows_per_page: number | null;
  }>(
    `SELECT user_id,
            timezone,
            week_start,
            date_time_format,
            holiday_calendar_code,
            holiday_calendar_codes,
            activity_rows_per_page
     FROM user_preferences
     WHERE user_id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const weekStart =
    row.week_start === "sunday" || row.week_start === "monday"
      ? row.week_start
      : "monday";

  const normalizedCodes: HolidayCalendarCode[] = [];
  const seenCodes = new Set<string>();
  if (Array.isArray(row.holiday_calendar_codes)) {
    for (const value of row.holiday_calendar_codes) {
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (!isHolidayCalendarCode(trimmed) || seenCodes.has(trimmed)) {
        continue;
      }
      seenCodes.add(trimmed);
      normalizedCodes.push(trimmed);
    }
  }

  let holidayCalendarCode: HolidayCalendarCode | null =
    normalizedCodes[0] ?? null;

  if (!holidayCalendarCode && row.holiday_calendar_code) {
    if (isHolidayCalendarCode(row.holiday_calendar_code)) {
      holidayCalendarCode = row.holiday_calendar_code;
      if (!seenCodes.has(holidayCalendarCode)) {
        normalizedCodes.push(holidayCalendarCode);
      }
    }
  }

  return {
    userId: row.user_id,
    timezone: row.timezone,
    weekStart,
    dateTimeFormat: row.date_time_format,
    holidayCalendarCode,
    holidayCalendarCodes: normalizedCodes,
    activityRowsPerPage:
      typeof row.activity_rows_per_page === "number"
        ? row.activity_rows_per_page
        : 25,
  };
}

export async function getUserPreferencesByIds(
  userIds: readonly string[],
): Promise<Map<string, UserPreferencesRow>> {
  if (!userIds.length) {
    return new Map();
  }

  const uniqueIds = Array.from(new Set(userIds));
  const result = await query<{
    user_id: string;
    timezone: string;
    week_start: string;
    date_time_format: string;
    holiday_calendar_code: HolidayCalendarCode | null;
    holiday_calendar_codes: HolidayCalendarCode[] | null;
    activity_rows_per_page: number | null;
  }>(
    `SELECT user_id,
            timezone,
            week_start,
            date_time_format,
            holiday_calendar_code,
            holiday_calendar_codes,
            activity_rows_per_page
     FROM user_preferences
     WHERE user_id = ANY($1::text[])`,
    [uniqueIds],
  );

  const map = new Map<string, UserPreferencesRow>();
  for (const row of result.rows) {
    const weekStart =
      row.week_start === "sunday" || row.week_start === "monday"
        ? row.week_start
        : "monday";

    const normalizedCodes: HolidayCalendarCode[] = [];
    const seen = new Set<string>();
    if (Array.isArray(row.holiday_calendar_codes)) {
      for (const value of row.holiday_calendar_codes) {
        if (typeof value !== "string") {
          continue;
        }
        const trimmed = value.trim();
        if (!isHolidayCalendarCode(trimmed) || seen.has(trimmed)) {
          continue;
        }
        seen.add(trimmed);
        normalizedCodes.push(trimmed);
      }
    }

    let holidayCalendarCode: HolidayCalendarCode | null =
      normalizedCodes[0] ?? null;

    if (!holidayCalendarCode && row.holiday_calendar_code) {
      if (isHolidayCalendarCode(row.holiday_calendar_code)) {
        holidayCalendarCode = row.holiday_calendar_code;
        if (!seen.has(holidayCalendarCode)) {
          normalizedCodes.push(holidayCalendarCode);
          seen.add(holidayCalendarCode);
        }
      }
    }

    map.set(row.user_id, {
      userId: row.user_id,
      timezone: row.timezone,
      weekStart,
      dateTimeFormat: row.date_time_format,
      holidayCalendarCode,
      holidayCalendarCodes: normalizedCodes,
      activityRowsPerPage:
        typeof row.activity_rows_per_page === "number"
          ? row.activity_rows_per_page
          : 25,
    });
  }

  return map;
}

export async function upsertUserPreferences(params: {
  userId: string;
  timezone: string;
  weekStart: "sunday" | "monday";
  dateTimeFormat: string;
  holidayCalendarCodes: HolidayCalendarCode[];
  activityRowsPerPage: number;
}) {
  const uniqueCodes = Array.from(
    new Set<HolidayCalendarCode>(params.holidayCalendarCodes),
  );
  const primaryCode = uniqueCodes[0] ?? null;

  await query(
    `INSERT INTO user_preferences (
       user_id,
       timezone,
       week_start,
       date_time_format,
       holiday_calendar_code,
       holiday_calendar_codes,
       activity_rows_per_page
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       timezone = EXCLUDED.timezone,
       week_start = EXCLUDED.week_start,
       date_time_format = EXCLUDED.date_time_format,
       holiday_calendar_code = EXCLUDED.holiday_calendar_code,
       holiday_calendar_codes = EXCLUDED.holiday_calendar_codes,
       activity_rows_per_page = EXCLUDED.activity_rows_per_page,
       updated_at = NOW()`,
    [
      params.userId,
      params.timezone,
      params.weekStart,
      params.dateTimeFormat,
      primaryCode,
      uniqueCodes,
      params.activityRowsPerPage,
    ],
  );
}

export type UserPersonalHolidayRow = {
  id: number;
  userId: string;
  label: string | null;
  startDate: string;
  endDate: string;
};

export async function listUserPersonalHolidays(
  userId: string,
): Promise<UserPersonalHolidayRow[]> {
  if (!userId) {
    return [];
  }

  const result = await query<{
    id: number;
    user_id: string;
    label: string | null;
    start_date: string;
    end_date: string;
  }>(
    `SELECT id,
            user_id,
            label,
            start_date::text AS start_date,
            end_date::text AS end_date
     FROM user_personal_holidays
     WHERE user_id = $1
     ORDER BY start_date, end_date, id`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    label: row.label ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}

export async function listUserPersonalHolidaysByIds(
  userIds: readonly string[],
): Promise<Map<string, UserPersonalHolidayRow[]>> {
  if (!userIds.length) {
    return new Map();
  }

  const uniqueIds = Array.from(new Set(userIds));
  const result = await query<{
    user_id: string;
    id: number;
    label: string | null;
    start_date: string;
    end_date: string;
  }>(
    `SELECT user_id,
            id,
            label,
            start_date::text AS start_date,
            end_date::text AS end_date
     FROM user_personal_holidays
     WHERE user_id = ANY($1::text[])
     ORDER BY user_id, start_date, end_date, id`,
    [uniqueIds],
  );

  const map = new Map<string, UserPersonalHolidayRow[]>();
  for (const row of result.rows) {
    const items = map.get(row.user_id) ?? [];
    items.push({
      id: row.id,
      userId: row.user_id,
      label: row.label,
      startDate: row.start_date,
      endDate: row.end_date,
    });
    map.set(row.user_id, items);
  }

  return map;
}

export async function createUserPersonalHoliday(params: {
  userId: string;
  label?: string | null;
  startDate: string;
  endDate: string;
}): Promise<UserPersonalHolidayRow> {
  const result = await query<{
    id: number;
    user_id: string;
    label: string | null;
    start_date: string;
    end_date: string;
  }>(
    `INSERT INTO user_personal_holidays (user_id, label, start_date, end_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id,
               user_id,
               label,
               start_date::text AS start_date,
               end_date::text AS end_date`,
    [params.userId, params.label ?? null, params.startDate, params.endDate],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert personal holiday.");
  }

  return {
    id: row.id,
    userId: row.user_id,
    label: row.label ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function updateUserPersonalHoliday(params: {
  id: number;
  userId: string;
  label?: string | null;
  startDate: string;
  endDate: string;
}): Promise<UserPersonalHolidayRow | null> {
  const result = await query<{
    id: number;
    user_id: string;
    label: string | null;
    start_date: string;
    end_date: string;
  }>(
    `UPDATE user_personal_holidays
     SET label = $3,
         start_date = $4,
         end_date = $5,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id,
               user_id,
               label,
               start_date::text AS start_date,
               end_date::text AS end_date`,
    [
      params.id,
      params.userId,
      params.label ?? null,
      params.startDate,
      params.endDate,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    label: row.label ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function deleteUserPersonalHoliday(params: {
  id: number;
  userId: string;
}): Promise<boolean> {
  const result = await query(
    `DELETE FROM user_personal_holidays
     WHERE id = $1 AND user_id = $2`,
    [params.id, params.userId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function updateUserAvatarUrl(
  userId: string,
  avatarUrl: string | null,
): Promise<{
  avatarUrl: string | null;
  originalAvatarUrl: string | null;
  customAvatarUrl: string | null;
}> {
  const existing = await query<{
    avatar_url: string | null;
    data: unknown;
  }>(`SELECT avatar_url, data FROM users WHERE id = $1`, [userId]);

  if (existing.rowCount === 0) {
    return { avatarUrl: null, originalAvatarUrl: null, customAvatarUrl: null };
  }

  const row = existing.rows[0];
  const parsed = parseStoredUserData(row.data);
  const actor = parsed.actor;
  const existingProfile = parsed.profile;
  const base = parsed.raw;

  let nextProfile: StoredUserProfile;

  if (avatarUrl) {
    let original = existingProfile.originalAvatarUrl;
    if (!original) {
      if (row.avatar_url && row.avatar_url !== avatarUrl) {
        original = row.avatar_url;
      } else if (actor?.avatarUrl) {
        original = actor.avatarUrl;
      }
    }

    nextProfile = {
      originalAvatarUrl: original ?? null,
      customAvatarUrl: avatarUrl,
    };
  } else {
    const original =
      existingProfile.originalAvatarUrl ?? actor?.avatarUrl ?? null;

    nextProfile = {
      originalAvatarUrl: original,
      customAvatarUrl: null,
    };
  }

  const nextData = buildStoredUserData(actor, nextProfile, base);
  const nextAvatarUrl =
    nextProfile.customAvatarUrl ?? nextProfile.originalAvatarUrl ?? null;

  await query(
    `UPDATE users SET avatar_url = $2, data = $3::jsonb, updated_at = NOW() WHERE id = $1`,
    [userId, nextAvatarUrl, JSON.stringify(nextData)],
  );

  return {
    avatarUrl: nextAvatarUrl,
    originalAvatarUrl: nextProfile.originalAvatarUrl ?? null,
    customAvatarUrl: nextProfile.customAvatarUrl ?? null,
  };
}

export async function getUserAvatarState(userId: string): Promise<{
  avatarUrl: string | null;
  originalAvatarUrl: string | null;
  customAvatarUrl: string | null;
}> {
  const result = await query<{
    avatar_url: string | null;
    data: unknown;
  }>(`SELECT avatar_url, data FROM users WHERE id = $1`, [userId]);

  if (result.rowCount === 0) {
    return { avatarUrl: null, originalAvatarUrl: null, customAvatarUrl: null };
  }

  const row = result.rows[0];
  const parsed = parseStoredUserData(row.data);

  return {
    avatarUrl: row.avatar_url ?? null,
    originalAvatarUrl:
      parsed.profile.originalAvatarUrl ?? parsed.actor?.avatarUrl ?? null,
    customAvatarUrl: parsed.profile.customAvatarUrl,
  };
}
