"use client";

import { Camera, ImageOff, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PickerInput } from "@/components/ui/picker-input";
import {
  DATE_TIME_FORMAT_OPTIONS,
  type DateTimeDisplayFormat,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
} from "@/lib/holidays/constants";
import type { CalendarHoliday, HolidayCalendar } from "@/lib/holidays/service";
import { buildUserInitials } from "@/lib/user/initials";
import type { PersonalHoliday } from "@/lib/user/time-settings";
import { cn } from "@/lib/utils";

const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Seoul",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const MAX_AVATAR_FILE_SIZE = 4 * 1024 * 1024; // 4MB
const ACCEPTED_AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ACTIVITY_ROWS_CHOICES = [10, 25, 50];

function buildTimezoneOptions(seed: string) {
  const options = new Set<string>();
  if (seed) {
    options.add(seed);
  }

  for (const zone of FALLBACK_TIMEZONES) {
    options.add(zone);
  }

  return Array.from(options);
}

function readSupportedTimezones() {
  try {
    const supportedValuesOf = (
      Intl as typeof Intl & {
        supportedValuesOf?: (keys: string) => string[];
      }
    ).supportedValuesOf;
    if (typeof supportedValuesOf === "function") {
      return supportedValuesOf("timeZone");
    }
  } catch (_error) {
    // ignore and fall back
  }

  return [];
}

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
  reauthRequired?: boolean;
};

export type SettingsPersonalTabProps = {
  timeZone: string;
  weekStart: "sunday" | "monday";
  dateTimeFormat: string;
  personalHolidayCalendarCodes: HolidayCalendarCode[];
  organizationHolidayCalendarCodes: HolidayCalendarCode[];
  holidayPreviewCalendarCode: HolidayCalendarCode | null;
  holidayCalendars: HolidayCalendar[];
  initialPreviewHolidayEntries: CalendarHoliday[];
  initialPersonalHolidays: PersonalHoliday[];
  activityRowsPerPage: number;
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserLogin: string | null;
  currentUserAvatarUrl: string | null;
  currentUserOriginalAvatarUrl: string | null;
  currentUserCustomAvatarUrl: string | null;
};

export function SettingsPersonalTab({
  timeZone,
  weekStart,
  dateTimeFormat,
  personalHolidayCalendarCodes,
  organizationHolidayCalendarCodes,
  holidayPreviewCalendarCode,
  holidayCalendars,
  initialPreviewHolidayEntries,
  initialPersonalHolidays,
  activityRowsPerPage: initialActivityRowsPerPage,
  currentUserId,
  currentUserName,
  currentUserLogin,
  currentUserAvatarUrl,
  currentUserOriginalAvatarUrl,
  currentUserCustomAvatarUrl,
}: SettingsPersonalTabProps) {
  const router = useRouter();

  const [timezone, setTimezone] = useState(timeZone);
  const [weekStartValue, setWeekStartValue] = useState<"sunday" | "monday">(
    weekStart,
  );
  const [dateTimeFormatValue, setDateTimeFormatValue] =
    useState<DateTimeDisplayFormat>(
      normalizeDateTimeDisplayFormat(dateTimeFormat),
    );
  const [personalHolidayCodes, setPersonalHolidayCodes] = useState<
    HolidayCalendarCode[]
  >(personalHolidayCalendarCodes);
  const [organizationHolidayCodes] = useState<HolidayCalendarCode[]>(
    organizationHolidayCalendarCodes,
  );
  const [previewHolidayCode, setPreviewHolidayCode] =
    useState<HolidayCalendarCode | null>(holidayPreviewCalendarCode);
  const [holidayEntries, setHolidayEntries] = useState<CalendarHoliday[]>(
    initialPreviewHolidayEntries,
  );
  const [personalHolidays, setPersonalHolidays] = useState<PersonalHoliday[]>(
    initialPersonalHolidays,
  );
  const [activityRowsPerPage, setActivityRowsPerPage] = useState(
    initialActivityRowsPerPage,
  );
  const [personalHolidayForm, setPersonalHolidayForm] = useState({
    id: null as number | null,
    label: "",
    startDate: "",
    endDate: "",
  });
  const [isSavingPersonalHolidayEntry, setIsSavingPersonalHolidayEntry] =
    useState(false);
  const [personalHolidayError, setPersonalHolidayError] = useState<
    string | null
  >(null);
  const [isLoadingPersonalHolidays, setIsLoadingPersonalHolidays] =
    useState(false);
  const [holidaySelectionError, setHolidaySelectionError] = useState<
    string | null
  >(null);
  const [personalFeedback, setPersonalFeedback] = useState<string | null>(null);
  const [persistedAvatarUrl, setPersistedAvatarUrl] = useState<string | null>(
    currentUserAvatarUrl,
  );
  const [persistedOriginalAvatarUrl, setPersistedOriginalAvatarUrl] = useState<
    string | null
  >(currentUserOriginalAvatarUrl);
  const [persistedCustomAvatarUrl, setPersistedCustomAvatarUrl] = useState<
    string | null
  >(currentUserCustomAvatarUrl);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    currentUserAvatarUrl,
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<string | null>(null);
  const tempAvatarUrlRef = useRef<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const holidayCacheRef = useRef<Map<string, CalendarHoliday[]>>(new Map());
  const personalHolidayRequestRef = useRef(0);
  const personalHolidayMutationRef = useRef(0);
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isSavingPersonal, startSavingPersonal] = useTransition();
  const [isUploadingAvatar, startUploadingAvatar] = useTransition();
  const [isRemovingAvatar, startRemovingAvatar] = useTransition();

  const avatarInputId = useId();
  const personalHolidayStartInputId = useId();
  const personalHolidayEndInputId = useId();
  const personalHolidayNoteInputId = useId();

  const avatarInitials = useMemo(
    () =>
      buildUserInitials({
        name: currentUserName,
        login: currentUserLogin,
        fallback: currentUserId,
      }),
    [currentUserId, currentUserLogin, currentUserName],
  );

  const sortedHolidayCalendars = useMemo(() => {
    return [...holidayCalendars].sort((a, b) => {
      const order = a.sortOrder - b.sortOrder;
      if (order !== 0) {
        return order;
      }
      return a.label.localeCompare(b.label, "ko", {
        sensitivity: "base",
      });
    });
  }, [holidayCalendars]);

  const activityRowsChoices = useMemo(() => {
    const values = new Set<number>(ACTIVITY_ROWS_CHOICES);
    if (Number.isFinite(activityRowsPerPage)) {
      values.add(Math.floor(Math.max(1, activityRowsPerPage)));
    }
    if (Number.isFinite(initialActivityRowsPerPage)) {
      values.add(Math.floor(Math.max(1, initialActivityRowsPerPage)));
    }
    return Array.from(values)
      .filter((value) => value > 0 && value <= 100)
      .sort((a, b) => a - b);
  }, [activityRowsPerPage, initialActivityRowsPerPage]);

  const hasPersistedAvatar = Boolean(persistedAvatarUrl);
  const hasCustomAvatar = Boolean(persistedCustomAvatarUrl);
  const hasSelectedAvatar = Boolean(avatarFile);
  const isAvatarMutating = isUploadingAvatar || isRemovingAvatar;

  const [timezones, setTimezones] = useState<string[]>(() =>
    buildTimezoneOptions(timeZone),
  );

  useEffect(() => {
    setTimezones(buildTimezoneOptions(timeZone));
  }, [timeZone]);

  useEffect(() => {
    const supported = readSupportedTimezones();
    if (!supported.length) {
      return;
    }

    setTimezones((previous) => {
      const merged = new Set(previous);
      for (const zone of supported) {
        merged.add(zone);
      }
      return Array.from(merged);
    });
  }, []);

  useEffect(() => {
    setPersistedAvatarUrl(currentUserAvatarUrl);
    setPersistedOriginalAvatarUrl(currentUserOriginalAvatarUrl);
    setPersistedCustomAvatarUrl(currentUserCustomAvatarUrl);
    if (!avatarFile) {
      setAvatarPreview(currentUserAvatarUrl);
    }
  }, [
    avatarFile,
    currentUserAvatarUrl,
    currentUserCustomAvatarUrl,
    currentUserOriginalAvatarUrl,
  ]);

  useEffect(() => {
    return () => {
      if (tempAvatarUrlRef.current) {
        URL.revokeObjectURL(tempAvatarUrlRef.current);
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setDateTimeFormatValue(normalizeDateTimeDisplayFormat(dateTimeFormat));
  }, [dateTimeFormat]);

  useEffect(() => {
    setActivityRowsPerPage(initialActivityRowsPerPage);
  }, [initialActivityRowsPerPage]);

  useEffect(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    if (!personalFeedback) {
      return;
    }

    feedbackTimeoutRef.current = setTimeout(() => {
      setPersonalFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 4000);
  }, [personalFeedback]);

  useEffect(() => {
    setPersonalHolidayCodes(personalHolidayCalendarCodes);
    setPersonalHolidays(initialPersonalHolidays);

    const sortedCodes = sortedHolidayCalendars.map((calendar) => calendar.code);
    const defaultPreviewCode =
      holidayPreviewCalendarCode ??
      personalHolidayCalendarCodes[0] ??
      organizationHolidayCalendarCodes[0] ??
      sortedCodes[0] ??
      DEFAULT_HOLIDAY_CALENDAR;

    setPreviewHolidayCode(defaultPreviewCode);
    holidayCacheRef.current.set(
      defaultPreviewCode,
      initialPreviewHolidayEntries,
    );
    setHolidayEntries(initialPreviewHolidayEntries);
    setHolidaySelectionError(null);
  }, [
    personalHolidayCalendarCodes,
    organizationHolidayCalendarCodes,
    holidayPreviewCalendarCode,
    initialPreviewHolidayEntries,
    initialPersonalHolidays,
    sortedHolidayCalendars,
  ]);

  const parseHolidayResponse = useCallback(
    async (
      response: Response,
    ): Promise<{
      success: boolean;
      message?: string;
      holidays?: CalendarHoliday[];
      holiday?: CalendarHoliday;
    }> => {
      const rawBody = await response.text();
      const trimmed = rawBody.trim();
      const statusLabel = response.statusText
        ? `${response.status} ${response.statusText}`
        : `${response.status}`;
      if (!trimmed) {
        throw new Error(`서버에서 빈 응답이 반환되었습니다. (${statusLabel})`);
      }
      try {
        return JSON.parse(trimmed) as {
          success: boolean;
          message?: string;
          holidays?: CalendarHoliday[];
          holiday?: CalendarHoliday;
        };
      } catch (_error) {
        throw new Error(`서버 응답을 해석하지 못했습니다. (${statusLabel})`);
      }
    },
    [],
  );

  const fetchHolidayEntries = useCallback(
    async (code: string) => {
      const cached = holidayCacheRef.current.get(code);
      if (cached) {
        return cached;
      }
      let response: Response;
      try {
        response = await fetch(
          `/api/holidays/calendars/${encodeURIComponent(code)}`,
        );
      } catch (_error) {
        throw new Error("공휴일 정보를 불러오지 못했습니다.");
      }
      const payload = await parseHolidayResponse(response);
      if (
        !response.ok ||
        !payload.success ||
        !Array.isArray(payload.holidays)
      ) {
        throw new Error(
          payload.message ?? "공휴일 정보를 불러오지 못했습니다.",
        );
      }
      holidayCacheRef.current.set(code, payload.holidays);
      return payload.holidays;
    },
    [parseHolidayResponse],
  );

  const resetPersonalHolidayForm = () => {
    setPersonalHolidayForm({
      id: null,
      label: "",
      startDate: "",
      endDate: "",
    });
    setPersonalHolidayError(null);
  };

  const handlePersonalHolidayFieldChange =
    (field: "label" | "startDate" | "endDate") =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setPersonalHolidayForm((previous) => ({
        ...previous,
        [field]: value,
      }));
    };

  const handleEditPersonalHoliday = (entry: PersonalHoliday) => {
    setPersonalHolidayForm({
      id: entry.id,
      label: entry.label ?? "",
      startDate: entry.startDate,
      endDate: entry.endDate,
    });
    setPersonalHolidayError(null);
  };

  const handleCancelPersonalHolidayEdit = () => {
    resetPersonalHolidayForm();
  };

  const handleSubmitPersonalHoliday = () => {
    if (isSavingPersonalHolidayEntry) {
      return;
    }

    const trimmedStart = personalHolidayForm.startDate.trim();
    if (!trimmedStart) {
      setPersonalHolidayError("시작일을 입력해 주세요.");
      return;
    }

    const trimmedEnd = personalHolidayForm.endDate.trim();
    const trimmedLabel = personalHolidayForm.label.trim();
    const editingId = personalHolidayForm.id;

    setPersonalHolidayError(null);
    setIsSavingPersonalHolidayEntry(true);
    const mutationId = personalHolidayMutationRef.current + 1;
    personalHolidayMutationRef.current = mutationId;

    const payloadBody = JSON.stringify({
      label: trimmedLabel.length ? trimmedLabel : undefined,
      startDate: trimmedStart,
      endDate: trimmedEnd.length ? trimmedEnd : undefined,
    });

    const targetUrl = editingId
      ? `/api/profile/holidays/${editingId}`
      : `/api/profile/holidays`;
    const method = editingId ? "PATCH" : "POST";

    fetch(targetUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payloadBody,
    })
      .then(async (response) => {
        const json = (await response.json()) as ApiResponse<PersonalHoliday>;
        if (!response.ok || !json.success || !json.result) {
          throw new Error(json.message ?? "개인 휴일을 저장하지 못했습니다.");
        }
        if (personalHolidayMutationRef.current !== mutationId) {
          return;
        }

        const result = json.result;
        setPersonalHolidays((previous) => {
          if (editingId) {
            return previous.map((entry) =>
              entry.id === editingId ? result : entry,
            );
          }
          const next = [...previous, result];
          next.sort((a, b) => a.startDate.localeCompare(b.startDate));
          return next;
        });
        setPersonalFeedback(
          editingId ? "개인 휴일을 수정했어요." : "개인 휴일을 추가했어요.",
        );
        resetPersonalHolidayForm();
      })
      .catch((error) => {
        console.error(error);
        if (personalHolidayMutationRef.current !== mutationId) {
          return;
        }
        setPersonalHolidayError(
          error instanceof Error
            ? error.message
            : "개인 휴일을 저장하지 못했습니다.",
        );
      })
      .finally(() => {
        if (personalHolidayMutationRef.current === mutationId) {
          setIsSavingPersonalHolidayEntry(false);
        }
      });
  };

  const handleDeletePersonalHoliday = (id: number) => {
    if (isSavingPersonalHolidayEntry) {
      return;
    }

    setPersonalHolidayError(null);
    setIsSavingPersonalHolidayEntry(true);
    const mutationId = personalHolidayMutationRef.current + 1;
    personalHolidayMutationRef.current = mutationId;

    fetch(`/api/profile/holidays/${id}`, { method: "DELETE" })
      .then(async (response) => {
        const json = (await response.json()) as ApiResponse<unknown>;
        if (!response.ok || !json.success) {
          throw new Error(json.message ?? "개인 휴일을 삭제하지 못했습니다.");
        }
        if (personalHolidayMutationRef.current !== mutationId) {
          return;
        }
        setPersonalHolidays((previous) =>
          previous.filter((entry) => entry.id !== id),
        );
        if (personalHolidayForm.id === id) {
          resetPersonalHolidayForm();
        }
        setPersonalFeedback("개인 휴일을 삭제했어요.");
      })
      .catch((error) => {
        console.error(error);
        if (personalHolidayMutationRef.current !== mutationId) {
          return;
        }
        setPersonalHolidayError(
          error instanceof Error
            ? error.message
            : "개인 휴일을 삭제하지 못했습니다.",
        );
      })
      .finally(() => {
        if (personalHolidayMutationRef.current === mutationId) {
          setIsSavingPersonalHolidayEntry(false);
        }
      });
  };

  const handlePreviewHolidaySelect = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const code = event.target.value as HolidayCalendarCode;
    setPreviewHolidayCode(code);
    setHolidaySelectionError(null);
    const requestId = personalHolidayRequestRef.current + 1;
    personalHolidayRequestRef.current = requestId;
    const cached = holidayCacheRef.current.get(code);
    if (cached) {
      setHolidayEntries(cached);
      setIsLoadingPersonalHolidays(false);
      return;
    }
    setIsLoadingPersonalHolidays(true);

    fetchHolidayEntries(code)
      .then((entries) => {
        if (personalHolidayRequestRef.current !== requestId) {
          return;
        }
        setHolidayEntries(entries);
      })
      .catch((error) => {
        console.error(error);
        if (personalHolidayRequestRef.current !== requestId) {
          return;
        }
        setHolidaySelectionError(
          error instanceof Error
            ? error.message
            : "공휴일 정보를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (personalHolidayRequestRef.current === requestId) {
          setIsLoadingPersonalHolidays(false);
        }
      });
  };

  const handleTogglePersonalHolidayCode = (code: HolidayCalendarCode) => {
    setPersonalHolidayCodes((previous) => {
      if (previous.includes(code)) {
        return previous.filter((value) => value !== code);
      }
      const next = [...previous, code];
      const order = new Map<HolidayCalendarCode, number>();
      sortedHolidayCalendars.forEach((calendar, index) => {
        order.set(calendar.code, index);
      });
      return next.sort((a, b) => {
        const indexA = order.get(a) ?? Number.MAX_SAFE_INTEGER;
        const indexB = order.get(b) ?? Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
      });
    });
  };

  const releaseTempAvatarPreview = () => {
    if (tempAvatarUrlRef.current) {
      URL.revokeObjectURL(tempAvatarUrlRef.current);
      tempAvatarUrlRef.current = null;
    }
  };

  const resetAvatarInput = () => {
    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  };

  const handleAvatarFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (file.size > MAX_AVATAR_FILE_SIZE) {
      setAvatarError("최대 4MB 이하의 이미지만 업로드할 수 있습니다.");
      setAvatarFeedback(null);
      return;
    }

    const normalizedType = (file.type || "").toLowerCase();
    const extension = file.name.split(".").pop()?.toLowerCase();
    const isAllowedType =
      (normalizedType.length > 0 &&
        ACCEPTED_AVATAR_MIME_TYPES.includes(normalizedType)) ||
      (extension ? ["png", "jpg", "jpeg", "webp"].includes(extension) : false);

    if (!isAllowedType) {
      setAvatarError("PNG, JPG, WebP 형식의 이미지만 업로드할 수 있습니다.");
      setAvatarFeedback(null);
      return;
    }

    releaseTempAvatarPreview();

    const previewUrl = URL.createObjectURL(file);
    tempAvatarUrlRef.current = previewUrl;
    setAvatarFile(file);
    setAvatarPreview(previewUrl);
    setAvatarError(null);
    setAvatarFeedback(null);
  };

  const handleUploadAvatar = () => {
    if (!avatarFile) {
      setAvatarError("업로드할 이미지를 먼저 선택해 주세요.");
      return;
    }

    setAvatarError(null);
    setAvatarFeedback(null);

    startUploadingAvatar(async () => {
      try {
        const formData = new FormData();
        formData.append("avatar", avatarFile);

        const response = await fetch("/api/profile/avatar", {
          method: "POST",
          body: formData,
        });

        const payload = (await response.json()) as ApiResponse<{
          avatarUrl?: string | null;
          originalAvatarUrl?: string | null;
          customAvatarUrl?: string | null;
        }>;

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.message ?? "프로필 사진을 업데이트하지 못했습니다.",
          );
        }

        const nextUrl = payload.result?.avatarUrl ?? null;
        if (!nextUrl) {
          throw new Error("업로드한 이미지 경로를 확인할 수 없습니다.");
        }

        releaseTempAvatarPreview();
        setAvatarFile(null);
        setPersistedAvatarUrl(nextUrl);
        setPersistedOriginalAvatarUrl(
          payload.result?.originalAvatarUrl ?? persistedOriginalAvatarUrl,
        );
        setPersistedCustomAvatarUrl(payload.result?.customAvatarUrl ?? nextUrl);
        setAvatarPreview(nextUrl);
        setAvatarFeedback("프로필 사진을 업데이트했어요.");
        resetAvatarInput();
        router.refresh();
      } catch (error) {
        console.error(error);
        setAvatarError(
          error instanceof Error
            ? error.message
            : "프로필 사진 업로드에 실패했습니다.",
        );
      }
    });
  };

  const handleRemoveAvatar = () => {
    if (avatarFile) {
      releaseTempAvatarPreview();
      setAvatarFile(null);
      setAvatarPreview(persistedAvatarUrl);
      setAvatarError(null);
      setAvatarFeedback(null);
      resetAvatarInput();
      return;
    }

    if (!persistedAvatarUrl) {
      setAvatarError("제거할 프로필 사진이 없습니다.");
      return;
    }

    setAvatarError(null);
    setAvatarFeedback(null);

    startRemovingAvatar(async () => {
      try {
        const response = await fetch("/api/profile/avatar", {
          method: "DELETE",
        });

        const payload = (await response.json()) as ApiResponse<{
          avatarUrl?: string | null;
          originalAvatarUrl?: string | null;
          customAvatarUrl?: string | null;
        }>;

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.message ?? "프로필 사진을 제거하지 못했습니다.",
          );
        }

        const nextAvatarUrl = payload.result?.avatarUrl ?? null;
        releaseTempAvatarPreview();
        setAvatarFile(null);
        setPersistedAvatarUrl(nextAvatarUrl);
        setPersistedOriginalAvatarUrl(
          payload.result?.originalAvatarUrl ?? persistedOriginalAvatarUrl,
        );
        setPersistedCustomAvatarUrl(payload.result?.customAvatarUrl ?? null);
        setAvatarPreview(nextAvatarUrl);
        setAvatarFeedback(
          nextAvatarUrl
            ? "GitHub 프로필 사진으로 되돌렸어요."
            : "프로필 사진을 제거했어요.",
        );
        resetAvatarInput();
        router.refresh();
      } catch (error) {
        console.error(error);
        setAvatarError(
          error instanceof Error
            ? error.message
            : "프로필 사진을 제거하지 못했습니다.",
        );
      }
    });
  };

  const handleSavePersonal = () => {
    setPersonalFeedback(null);
    startSavingPersonal(async () => {
      try {
        const response = await fetch("/api/sync/config", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            timezone,
            weekStart: weekStartValue,
            dateTimeFormat: dateTimeFormatValue,
            holidayCalendarCodes: personalHolidayCodes,
            activityRowsPerPage,
          }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (!data.success) {
          throw new Error(data.message ?? "설정을 저장하지 못했습니다.");
        }

        setPersonalFeedback("설정이 저장되었습니다.");
        router.refresh();
      } catch (error) {
        setPersonalFeedback(
          error instanceof Error
            ? error.message
            : "설정 저장 중 오류가 발생했습니다.",
        );
      }
    });
  };

  return (
    <section className="flex flex-col gap-4">
      {personalFeedback && (
        <p className="text-sm text-primary">{personalFeedback}</p>
      )}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>프로필 이미지</CardTitle>
          <CardDescription>
            대시보드 상단에 표시될 사진을 업로드하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center justify-center">
              {avatarPreview ? (
                <div className="relative size-20 overflow-hidden rounded-full border border-border/70 bg-white shadow-sm">
                  <Image
                    src={avatarPreview}
                    alt={currentUserName ?? currentUserLogin ?? avatarInitials}
                    fill
                    sizes="80px"
                    className="object-cover"
                    referrerPolicy="no-referrer"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="flex size-20 items-center justify-center rounded-full border border-dashed border-border/70 bg-muted/40 text-lg font-semibold uppercase text-muted-foreground">
                  {avatarInitials}
                </div>
              )}
            </div>
            <div className="flex w-full max-w-sm flex-col gap-3 text-sm">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={avatarInputId}
                  className="text-muted-foreground"
                >
                  프로필 사진 선택
                </label>
                <input
                  ref={avatarInputRef}
                  id={avatarInputId}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarFileChange}
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  PNG, JPG, WebP 형식 · 최대 4MB
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleUploadAvatar}
                  disabled={isAvatarMutating || !hasSelectedAvatar}
                  className="h-9"
                >
                  {isUploadingAvatar ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      업로드 중...
                    </>
                  ) : (
                    <>
                      <Camera className="mr-2 h-4 w-4" />
                      사진 업로드
                    </>
                  )}
                </Button>
                {(hasSelectedAvatar || hasPersistedAvatar) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleRemoveAvatar}
                    disabled={
                      isAvatarMutating ||
                      (!hasSelectedAvatar && !hasPersistedAvatar)
                    }
                    className="h-9"
                  >
                    {isRemovingAvatar ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        처리 중...
                      </>
                    ) : hasSelectedAvatar ? (
                      <>
                        <ImageOff className="mr-2 h-4 w-4" />
                        선택 취소
                      </>
                    ) : hasCustomAvatar ? (
                      <>
                        <ImageOff className="mr-2 h-4 w-4" />
                        사진 제거
                      </>
                    ) : (
                      <>
                        <ImageOff className="mr-2 h-4 w-4" />
                        기본 이미지 사용
                      </>
                    )}
                  </Button>
                )}
              </div>
              {avatarError ? (
                <p className="text-xs text-rose-600">{avatarError}</p>
              ) : null}
              {avatarFeedback ? (
                <p className="text-xs text-emerald-600">{avatarFeedback}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>시간대 & 표시 형식</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <label className="flex flex-col gap-2">
            <span className="text-muted-foreground">표준 시간대</span>
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="rounded-md border border-border/60 bg-background p-2 text-sm"
            >
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-muted-foreground">주의 시작 요일</span>
            <select
              value={weekStartValue}
              onChange={(event) =>
                setWeekStartValue(event.target.value as "sunday" | "monday")
              }
              className="rounded-md border border-border/60 bg-background p-2 text-sm"
            >
              <option value="monday">월요일 시작</option>
              <option value="sunday">일요일 시작</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-muted-foreground">날짜와 시간 형식</span>
            <select
              value={dateTimeFormatValue}
              onChange={(event) =>
                setDateTimeFormatValue(
                  normalizeDateTimeDisplayFormat(event.target.value),
                )
              }
              className="rounded-md border border-border/60 bg-background p-2 text-sm"
            >
              {DATE_TIME_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.example ? ` · ${option.example}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-2">
              <span className="text-muted-foreground">Activity Rows</span>
              <select
                value={activityRowsPerPage}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(next)) {
                    setActivityRowsPerPage(Math.min(100, Math.max(1, next)));
                  }
                }}
                className="rounded-md border border-border/60 bg-background p-2 text-sm"
              >
                {activityRowsChoices.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Activity 탭의 Rows 기본 값을 설정합니다.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>개인 휴무일</CardTitle>
          <CardDescription>
            휴가나 정기 휴무일을 등록하면 해당 기간도 자동으로 제외돼요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor={personalHolidayStartInputId}
                className="text-muted-foreground"
              >
                시작일
              </label>
              <PickerInput
                id={personalHolidayStartInputId}
                value={personalHolidayForm.startDate}
                onChange={handlePersonalHolidayFieldChange("startDate")}
                className="rounded-md border border-border/60 bg-background p-2 text-sm"
                pickerButtonLabel="달력 열기"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor={personalHolidayEndInputId}
                className="text-muted-foreground"
              >
                종료일
              </label>
              <PickerInput
                id={personalHolidayEndInputId}
                value={personalHolidayForm.endDate}
                onChange={handlePersonalHolidayFieldChange("endDate")}
                className="rounded-md border border-border/60 bg-background p-2 text-sm"
                pickerButtonLabel="달력 열기"
              />
              <span className="text-xs text-muted-foreground">
                날짜를 비워두면 시작일 하루만 적용돼요.
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-2">
              <label
                htmlFor={personalHolidayNoteInputId}
                className="text-muted-foreground"
              >
                메모 (선택)
              </label>
              <Input
                id={personalHolidayNoteInputId}
                value={personalHolidayForm.label}
                onChange={handlePersonalHolidayFieldChange("label")}
                placeholder="예: 연차, 출장"
              />
            </div>
          </div>
          {personalHolidayError ? (
            <p className="text-xs text-rose-600">{personalHolidayError}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSubmitPersonalHoliday}
              disabled={isSavingPersonalHolidayEntry}
              className="h-9"
            >
              {isSavingPersonalHolidayEntry ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  저장 중...
                </>
              ) : personalHolidayForm.id ? (
                "휴무일 수정"
              ) : (
                "휴무일 추가"
              )}
            </Button>
            {personalHolidayForm.id ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCancelPersonalHolidayEdit}
                disabled={isSavingPersonalHolidayEntry}
                className="h-9"
              >
                취소
              </Button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-md border border-border/60">
            {personalHolidays.length ? (
              <table className="min-w-full divide-y divide-border/80 text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">기간</th>
                    <th className="px-3 py-2 text-left font-medium">메모</th>
                    <th className="px-3 py-2 text-right font-medium">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 bg-background">
                  {personalHolidays.map((entry) => {
                    const period =
                      entry.startDate === entry.endDate
                        ? entry.startDate
                        : `${entry.startDate} ~ ${entry.endDate}`;
                    return (
                      <tr key={entry.id}>
                        <td className="px-3 py-2 font-mono text-xs">
                          {period}
                        </td>
                        <td className="px-3 py-2">{entry.label ?? "-"}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditPersonalHoliday(entry)}
                              disabled={isSavingPersonalHolidayEntry}
                              className="h-8"
                            >
                              수정
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-rose-600 hover:bg-rose-50"
                              onClick={() =>
                                handleDeletePersonalHoliday(entry.id)
                              }
                              disabled={isSavingPersonalHolidayEntry}
                            >
                              삭제
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                등록된 개인 휴무일이 없습니다.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>공휴일 설정</CardTitle>
          <CardDescription>
            선택한 공휴일 달력과 개인 휴무일은 응답 없는 리뷰 요청과 멘션
            계산에서 제외돼요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">적용할 공휴일 달력</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {sortedHolidayCalendars.map((calendar) => {
                const checkboxId = `personal-calendar-${calendar.code}`;
                const isChecked = personalHolidayCodes.includes(calendar.code);
                const isOrgSelected = organizationHolidayCodes.includes(
                  calendar.code,
                );
                const cachedEntries = holidayCacheRef.current.get(
                  calendar.code,
                );
                const count =
                  cachedEntries?.length ?? calendar.holidayCount ?? 0;

                return (
                  <label
                    key={calendar.code}
                    htmlFor={checkboxId}
                    className={cn(
                      "flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm shadow-sm transition",
                      isChecked
                        ? "border-primary/70 ring-1 ring-primary/30"
                        : "hover:border-border",
                    )}
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus-visible:ring-primary"
                      checked={isChecked}
                      onChange={() =>
                        handleTogglePersonalHolidayCode(calendar.code)
                      }
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {calendar.label}
                        {count ? ` · ${count.toLocaleString()}일` : ""}
                      </span>
                      {isOrgSelected ? (
                        <span className="text-xs text-muted-foreground">
                          조직 공휴일에도 포함됨
                        </span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              미선택 시 조직 공휴일이 그대로 적용돼요.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">공휴일 미리보기</span>
            <select
              value={previewHolidayCode ?? ""}
              onChange={handlePreviewHolidaySelect}
              className="rounded-md border border-border/60 bg-background p-2 text-sm"
            >
              {sortedHolidayCalendars.map((calendar) => (
                <option key={calendar.code} value={calendar.code}>
                  {calendar.label}
                </option>
              ))}
            </select>
            {holidaySelectionError ? (
              <p className="text-xs text-rose-600">{holidaySelectionError}</p>
            ) : null}
            <div className="overflow-hidden rounded-md border border-border/60">
              {isLoadingPersonalHolidays ? (
                <p className="p-4 text-sm text-muted-foreground">
                  공휴일 목록을 불러오는 중입니다...
                </p>
              ) : previewHolidayCode && holidayEntries.length ? (
                <table className="min-w-full divide-y divide-border/80 text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">날짜</th>
                      <th className="px-3 py-2 text-left font-medium">요일</th>
                      <th className="px-3 py-2 text-left font-medium">
                        공휴일명
                      </th>
                      <th className="px-3 py-2 text-left font-medium">비고</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 bg-background">
                    {holidayEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2 font-mono text-xs">
                          {entry.holidayDate}
                        </td>
                        <td className="px-3 py-2">{entry.weekday ?? "-"}</td>
                        <td className="px-3 py-2">{entry.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.note ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  선택한 달력의 공휴일 정보가 없습니다.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSavePersonal} disabled={isSavingPersonal}>
          {isSavingPersonal ? "저장 중..." : "개인 설정 저장"}
        </Button>
      </div>
    </section>
  );
}
