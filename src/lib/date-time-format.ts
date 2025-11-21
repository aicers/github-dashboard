import { DateTime } from "luxon";

export const DATE_TIME_FORMAT_OPTIONS = [
  {
    value: "auto",
    label: "시스템 기본 (자동)",
    example: "브라우저 기본 설정",
  },
  {
    value: "iso-24h",
    label: "ISO 8601 · 24시간제",
    example: "2024-04-15 14:30",
  },
  {
    value: "dot-24h",
    label: "2010년형 한국어 · 24시간제",
    example: "2024.04.15 14:30",
  },
  {
    value: "ko-12h",
    label: "한국어 · 오전/오후",
    example: "2024년 4월 15일 오후 2:30",
  },
  {
    value: "en-us-12h",
    label: "미국식 · 12시간제",
    example: "Apr 15, 2024, 2:30 PM",
  },
  {
    value: "en-gb-24h",
    label: "영국식 · 24시간제",
    example: "15 Apr 2024, 14:30",
  },
] as const;

export type DateTimeDisplayFormat =
  (typeof DATE_TIME_FORMAT_OPTIONS)[number]["value"];

export const DATE_TIME_FORMAT_VALUES = DATE_TIME_FORMAT_OPTIONS.map(
  (option) => option.value,
) as readonly DateTimeDisplayFormat[];

export const DEFAULT_DATE_TIME_FORMAT: DateTimeDisplayFormat = "auto";

export function isValidDateTimeDisplayFormat(
  value: string,
): value is DateTimeDisplayFormat {
  return (DATE_TIME_FORMAT_VALUES as readonly string[]).includes(value);
}

export function normalizeDateTimeDisplayFormat(
  value: string | null | undefined,
): DateTimeDisplayFormat {
  if (!value) {
    return DEFAULT_DATE_TIME_FORMAT;
  }

  const trimmed = value.trim();
  return isValidDateTimeDisplayFormat(trimmed)
    ? trimmed
    : DEFAULT_DATE_TIME_FORMAT;
}

function coerceIsoInput(
  value: string | number | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    try {
      return new Date(value).toISOString();
    } catch {
      return null;
    }
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      return null;
    }
    return value.toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toISOString" in value &&
    typeof (value as { toISOString?: () => string }).toISOString === "function"
  ) {
    try {
      return (value as { toISOString: () => string }).toISOString() ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

type FormatDateTimeDisplayOptions = {
  timeZone?: string | null;
  format?: DateTimeDisplayFormat | null;
  locale?: string | null;
};

export function formatDateTimeDisplay(
  value: string | number | Date | null | undefined,
  options: FormatDateTimeDisplayOptions = {},
): string | null {
  const isoInput = coerceIsoInput(value);
  if (!isoInput) {
    return null;
  }

  const trimmed = isoInput.trim();
  if (!trimmed.length) {
    return null;
  }

  let date = DateTime.fromISO(trimmed);
  if (!date.isValid) {
    return null;
  }

  const zone = options.timeZone?.trim();
  if (zone?.length) {
    date = date.setZone(zone);
  }

  const format = normalizeDateTimeDisplayFormat(options.format);

  switch (format) {
    case "iso-24h":
      return date.toFormat("yyyy-LL-dd HH:mm");
    case "dot-24h":
      return date.toFormat("yyyy.MM.dd HH:mm");
    case "ko-12h": {
      const hour24 = date.hour;
      const meridiem = hour24 >= 12 ? "오후" : "오전";
      const hour12 = hour24 % 12 || 12;
      const paddedMinute = String(date.minute).padStart(2, "0");
      return `${date.year}년 ${date.month}월 ${date.day}일 ${meridiem} ${hour12}:${paddedMinute}`;
    }
    case "en-us-12h":
      return date.setLocale("en-US").toFormat("MMM d, yyyy h:mm a");
    case "en-gb-24h":
      return date.setLocale("en-GB").toFormat("d MMM yyyy, HH:mm");
    default: {
      const locale =
        options.locale ??
        (typeof navigator !== "undefined" ? navigator.language : undefined);
      const localized = locale ? date.setLocale(locale) : date;
      return localized.toLocaleString(DateTime.DATETIME_MED);
    }
  }
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  timeZone?: string | null,
  displayFormat?: DateTimeDisplayFormat | null,
) {
  const isoInput = coerceIsoInput(value);
  if (!isoInput) {
    return "-";
  }

  const trimmedZone = timeZone?.trim();
  const formatted = formatDateTimeDisplay(isoInput, {
    timeZone: trimmedZone,
    format: displayFormat ?? undefined,
  });

  if (formatted) {
    return formatted;
  }

  return isoInput;
}

export function formatDateOnly(
  value: string | number | Date | null | undefined,
  timeZone?: string | null,
) {
  const isoInput = coerceIsoInput(value);
  if (!isoInput) {
    return "-";
  }

  const trimmed = isoInput.trim();
  if (!trimmed.length) {
    return "-";
  }

  try {
    let date = DateTime.fromISO(trimmed);
    if (!date.isValid) {
      return trimmed;
    }

    const zone = timeZone?.trim();
    if (zone?.length) {
      date = date.setZone(zone);
    }

    return date.toFormat("yyyy-LL-dd");
  } catch {
    return trimmed;
  }
}
