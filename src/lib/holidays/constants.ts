export type HolidayCalendarCode =
  | "kr"
  | "us-ca"
  | "us-ny"
  | "jp"
  | "cn"
  | "uk"
  | "fr"
  | "uz";

export type HolidayCalendarDefinition = {
  code: HolidayCalendarCode;
  label: string;
  countryLabel: string;
  regionLabel: string | null;
  sortOrder: number;
};

export const HOLIDAY_CALENDAR_DEFINITIONS: HolidayCalendarDefinition[] = [
  {
    code: "kr",
    label: "한국",
    countryLabel: "한국",
    regionLabel: null,
    sortOrder: 1,
  },
  {
    code: "us-ca",
    label: "미국 캘리포니아",
    countryLabel: "미국",
    regionLabel: "캘리포니아",
    sortOrder: 2,
  },
  {
    code: "us-ny",
    label: "미국 뉴욕",
    countryLabel: "미국",
    regionLabel: "뉴욕",
    sortOrder: 3,
  },
  {
    code: "jp",
    label: "일본",
    countryLabel: "일본",
    regionLabel: null,
    sortOrder: 4,
  },
  {
    code: "cn",
    label: "중국",
    countryLabel: "중국",
    regionLabel: null,
    sortOrder: 5,
  },
  {
    code: "uk",
    label: "영국",
    countryLabel: "영국",
    regionLabel: null,
    sortOrder: 6,
  },
  {
    code: "fr",
    label: "프랑스",
    countryLabel: "프랑스",
    regionLabel: null,
    sortOrder: 7,
  },
  {
    code: "uz",
    label: "우즈베키스탄",
    countryLabel: "우즈베키스탄",
    regionLabel: null,
    sortOrder: 8,
  },
];

export const DEFAULT_HOLIDAY_CALENDAR: HolidayCalendarCode = "kr";

export const HOLIDAY_SOURCE_COUNTRY_MAP: Record<
  string,
  readonly HolidayCalendarCode[]
> = {
  한국: ["kr"],
  미국: ["us-ca", "us-ny"],
  일본: ["jp"],
  중국: ["cn"],
  영국: ["uk"],
  프랑스: ["fr"],
  우즈베키스탄: ["uz"],
};

export function sortHolidayCalendars<T extends { sortOrder: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isHolidayCalendarCode(
  value: string,
): value is HolidayCalendarCode {
  return HOLIDAY_CALENDAR_DEFINITIONS.some(
    (definition) => definition.code === value,
  );
}
