import { buildHolidaySet } from "@/lib/dashboard/business-days-core";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  HOLIDAY_CALENDAR_DEFINITIONS,
  type HolidayCalendarCode,
} from "@/lib/holidays/constants";

export type HolidayCalendar = {
  code: HolidayCalendarCode;
  label: string;
  countryLabel: string;
  regionLabel: string | null;
  sortOrder: number;
  holidayCount: number;
};

export type CalendarHoliday = {
  id: number;
  calendarCode: HolidayCalendarCode;
  year: number;
  dateKey: string;
  holidayDate: string;
  weekday: string | null;
  name: string;
  note: string | null;
};

const HOLIDAY_SET_CACHE = new Map<HolidayCalendarCode, ReadonlySet<string>>();

function toIsoDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function deriveYear(isoDate: string): number {
  return Number.parseInt(isoDate.slice(0, 4), 10);
}

function deriveDateKey(isoDate: string): string {
  return isoDate.slice(5, 10);
}

function normalizeWeekday(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeNote(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Holiday 이름을 입력해 주세요.");
  }
  return trimmed;
}

function normalizeIsoDate(value: string): string {
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

async function resolveCalendar(calendarCode: string) {
  const result = await query<{
    code: HolidayCalendarCode;
    label: string;
    country_label: string;
    region_label: string | null;
    sort_order: number;
  }>(
    `SELECT code, label, country_label, region_label, sort_order
     FROM holiday_calendars
     WHERE code = $1`,
    [calendarCode],
  );

  const calendar = result.rows[0];
  if (!calendar) {
    throw new Error("존재하지 않는 공휴일 달력입니다.");
  }

  return calendar;
}

async function readHolidayDateStrings(
  calendarCode: HolidayCalendarCode,
): Promise<string[]> {
  const result = await query<{ holiday_date: string }>(
    `SELECT holiday_date::text AS holiday_date
     FROM calendar_holidays
     WHERE calendar_code = $1`,
    [calendarCode],
  );

  return result.rows.map((row) => toIsoDate(row.holiday_date));
}

export function invalidateHolidayCache(
  calendarCode?: HolidayCalendarCode,
): void {
  if (calendarCode) {
    HOLIDAY_SET_CACHE.delete(calendarCode);
    return;
  }
  HOLIDAY_SET_CACHE.clear();
}

export async function loadHolidaySet(
  calendarCode: HolidayCalendarCode,
): Promise<ReadonlySet<string>> {
  await ensureSchema();

  const cached = HOLIDAY_SET_CACHE.get(calendarCode);
  if (cached) {
    return cached;
  }

  const dates = await readHolidayDateStrings(calendarCode);
  const set = buildHolidaySet(dates);
  HOLIDAY_SET_CACHE.set(calendarCode, set);
  return set;
}

export async function listHolidayCalendars(): Promise<HolidayCalendar[]> {
  await ensureSchema();

  const result = await query<{
    code: HolidayCalendarCode;
    label: string;
    country_label: string;
    region_label: string | null;
    sort_order: number;
    holiday_count: string | null;
  }>(
    `SELECT c.code,
            c.label,
            c.country_label,
            c.region_label,
            c.sort_order,
            COALESCE(h.count, 0) AS holiday_count
     FROM holiday_calendars c
     LEFT JOIN (
       SELECT calendar_code, COUNT(*)::bigint AS count
       FROM calendar_holidays
       GROUP BY calendar_code
     ) h ON h.calendar_code = c.code
     ORDER BY c.sort_order, c.label`,
  );

  const mapped = result.rows.map((row) => ({
    code: row.code,
    label: row.label,
    countryLabel: row.country_label,
    regionLabel: row.region_label,
    sortOrder: row.sort_order,
    holidayCount: Number.parseInt(row.holiday_count ?? "0", 10),
  }));

  for (const definition of HOLIDAY_CALENDAR_DEFINITIONS) {
    if (mapped.some((calendar) => calendar.code === definition.code)) {
      continue;
    }
    mapped.push({
      code: definition.code,
      label: definition.label,
      countryLabel: definition.countryLabel,
      regionLabel: definition.regionLabel,
      sortOrder: definition.sortOrder,
      holidayCount: 0,
    });
  }

  return mapped.sort((a, b) => {
    const order = a.sortOrder - b.sortOrder;
    if (order !== 0) {
      return order;
    }
    return a.label.localeCompare(b.label);
  });
}

export async function getCalendarHolidays(
  calendarCode: string,
): Promise<CalendarHoliday[]> {
  await ensureSchema();
  await resolveCalendar(calendarCode);

  const result = await query<{
    id: number;
    calendar_code: HolidayCalendarCode;
    year: number;
    date_key: string;
    holiday_date: string;
    weekday: string | null;
    name: string;
    note: string | null;
  }>(
    `SELECT id,
            calendar_code,
            year,
            date_key,
            holiday_date::text AS holiday_date,
            weekday,
            name,
            note
     FROM calendar_holidays
     WHERE calendar_code = $1
     ORDER BY holiday_date, name`,
    [calendarCode],
  );

  return result.rows.map((row) => ({
    id: row.id,
    calendarCode: row.calendar_code,
    year: row.year,
    dateKey: row.date_key,
    holidayDate: toIsoDate(row.holiday_date),
    weekday: row.weekday,
    name: row.name,
    note: row.note,
  }));
}

export async function createHoliday(params: {
  calendarCode: string;
  holidayDate: string;
  weekday?: string | null;
  name: string;
  note?: string | null;
}): Promise<CalendarHoliday> {
  await ensureSchema();
  const calendar = await resolveCalendar(params.calendarCode);

  const isoDate = normalizeIsoDate(params.holidayDate);
  const weekday = normalizeWeekday(params.weekday);
  const note = normalizeNote(params.note);
  const name = normalizeName(params.name);
  const year = deriveYear(isoDate);
  const dateKey = deriveDateKey(isoDate);

  const result = await query<{
    id: number;
    calendar_code: HolidayCalendarCode;
    year: number;
    date_key: string;
    holiday_date: string;
    weekday: string | null;
    name: string;
    note: string | null;
  }>(
    `INSERT INTO calendar_holidays (
       calendar_code,
       source_country,
       year,
       date_key,
       holiday_date,
       weekday,
       name,
       note
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (calendar_code, holiday_date, name) DO NOTHING
     RETURNING id,
               calendar_code,
               year,
               date_key,
               holiday_date::text AS holiday_date,
               weekday,
               name,
               note`,
    [
      calendar.code,
      calendar.country_label,
      year,
      dateKey,
      isoDate,
      weekday,
      name,
      note,
    ],
  );

  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error("이미 동일한 날짜와 이름의 공휴일이 존재합니다.");
  }

  invalidateHolidayCache(inserted.calendar_code);

  return {
    id: inserted.id,
    calendarCode: inserted.calendar_code,
    year: inserted.year,
    dateKey: inserted.date_key,
    holidayDate: toIsoDate(inserted.holiday_date),
    weekday: inserted.weekday,
    name: inserted.name,
    note: inserted.note,
  };
}

export async function updateHoliday(params: {
  id: number;
  calendarCode: string;
  holidayDate: string;
  weekday?: string | null;
  name: string;
  note?: string | null;
}): Promise<CalendarHoliday> {
  await ensureSchema();
  const calendar = await resolveCalendar(params.calendarCode);

  const isoDate = normalizeIsoDate(params.holidayDate);
  const weekday = normalizeWeekday(params.weekday);
  const note = normalizeNote(params.note);
  const name = normalizeName(params.name);
  const year = deriveYear(isoDate);
  const dateKey = deriveDateKey(isoDate);

  const result = await query<{
    id: number;
    calendar_code: HolidayCalendarCode;
    year: number;
    date_key: string;
    holiday_date: string;
    weekday: string | null;
    name: string;
    note: string | null;
  }>(
    `UPDATE calendar_holidays
     SET calendar_code = $1,
         source_country = $2,
         year = $3,
         date_key = $4,
         holiday_date = $5,
         weekday = $6,
         name = $7,
         note = $8,
         updated_at = NOW()
     WHERE id = $9
     RETURNING id,
               calendar_code,
               year,
               date_key,
               holiday_date::text AS holiday_date,
               weekday,
               name,
               note`,
    [
      calendar.code,
      calendar.country_label,
      year,
      dateKey,
      isoDate,
      weekday,
      name,
      note,
      params.id,
    ],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new Error("공휴일 항목을 찾을 수 없습니다.");
  }

  invalidateHolidayCache(updated.calendar_code);

  return {
    id: updated.id,
    calendarCode: updated.calendar_code,
    year: updated.year,
    dateKey: updated.date_key,
    holidayDate: toIsoDate(updated.holiday_date),
    weekday: updated.weekday,
    name: updated.name,
    note: updated.note,
  };
}

export async function deleteHoliday(id: number): Promise<void> {
  await ensureSchema();
  const result = await query<{
    calendar_code: HolidayCalendarCode;
  }>(
    `DELETE FROM calendar_holidays
     WHERE id = $1
     RETURNING calendar_code`,
    [id],
  );

  const removed = result.rows[0];
  if (!removed) {
    throw new Error("공휴일 항목을 찾을 수 없습니다.");
  }

  invalidateHolidayCache(removed.calendar_code);
}

export function coerceHolidayCalendarCode(
  code: string | null | undefined,
): HolidayCalendarCode {
  const normalized = (code ?? "").trim();
  if (!normalized) {
    return DEFAULT_HOLIDAY_CALENDAR;
  }
  const candidate = normalized as HolidayCalendarCode;
  const knownCodes = new Set(
    HOLIDAY_CALENDAR_DEFINITIONS.map((definition) => definition.code),
  );
  if (knownCodes.has(candidate)) {
    return candidate;
  }
  return DEFAULT_HOLIDAY_CALENDAR;
}
