"use client";

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
import type { HolidayCalendarCode } from "@/lib/holidays/constants";
import type { CalendarHoliday, HolidayCalendar } from "@/lib/holidays/service";
import { cn } from "@/lib/utils";

type HolidayFormState = {
  id: number | null;
  date: string;
  weekday: string;
  name: string;
  note: string;
};

type HolidayApiResponse = {
  success: boolean;
  message?: string;
  holidays?: CalendarHoliday[];
  holiday?: CalendarHoliday;
};

export type SettingsOrgHolidayPanelProps = {
  organizationHolidayCodes: HolidayCalendarCode[];
  onOrganizationHolidayCodesChange: (codes: HolidayCalendarCode[]) => void;
  holidayCalendars: HolidayCalendar[];
  initialPreviewHolidayEntries: CalendarHoliday[];
  holidayPreviewCalendarCode: HolidayCalendarCode | null;
  initialAdminCalendarCode: HolidayCalendarCode;
  isAdmin: boolean;
};

export function SettingsOrgHolidayPanel({
  organizationHolidayCodes,
  onOrganizationHolidayCodesChange,
  holidayCalendars,
  initialPreviewHolidayEntries,
  holidayPreviewCalendarCode,
  initialAdminCalendarCode,
  isAdmin,
}: SettingsOrgHolidayPanelProps) {
  const canEditOrganization = isAdmin;

  const [adminCalendarCode, setAdminCalendarCode] =
    useState<HolidayCalendarCode>(initialAdminCalendarCode);
  const [adminHolidayEntries, setAdminHolidayEntries] = useState<
    CalendarHoliday[]
  >(
    initialAdminCalendarCode === holidayPreviewCalendarCode
      ? initialPreviewHolidayEntries
      : [],
  );
  const [isLoadingAdminHolidays, setIsLoadingAdminHolidays] = useState(false);
  const [holidayAdminError, setHolidayAdminError] = useState<string | null>(
    null,
  );
  const [holidayAdminFeedback, setHolidayAdminFeedback] = useState<
    string | null
  >(null);
  const [holidayForm, setHolidayForm] = useState<HolidayFormState>({
    id: null,
    date: "",
    weekday: "",
    name: "",
    note: "",
  });
  const [isMutatingHoliday, startMutatingHoliday] = useTransition();

  const holidayCacheRef = useRef<Map<string, CalendarHoliday[]>>(new Map());
  const adminHolidayRequestRef = useRef(0);

  const holidayDateInputId = useId();
  const holidayWeekdayInputId = useId();
  const holidayNameInputId = useId();
  const holidayNoteInputId = useId();

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

  const parseHolidayResponse = useCallback(
    async (response: Response): Promise<HolidayApiResponse> => {
      const rawBody = await response.text();
      const trimmed = rawBody.trim();
      const statusLabel = response.statusText
        ? `${response.status} ${response.statusText}`
        : `${response.status}`;
      if (!trimmed) {
        throw new Error(`서버에서 빈 응답이 반환되었습니다. (${statusLabel})`);
      }
      try {
        return JSON.parse(trimmed) as HolidayApiResponse;
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

  useEffect(() => {
    const sortedCodes = sortedHolidayCalendars.map((calendar) => calendar.code);
    const defaultPreviewCode =
      holidayPreviewCalendarCode ??
      organizationHolidayCodes[0] ??
      sortedCodes[0] ??
      initialAdminCalendarCode;

    const adminDefaultCode =
      organizationHolidayCodes[0] ??
      defaultPreviewCode ??
      sortedCodes[0] ??
      initialAdminCalendarCode;

    setAdminCalendarCode(adminDefaultCode);
    setHolidayAdminError(null);

    if (adminDefaultCode === defaultPreviewCode) {
      setAdminHolidayEntries(initialPreviewHolidayEntries);
      setIsLoadingAdminHolidays(false);
    } else {
      setAdminHolidayEntries([]);
      if (adminDefaultCode) {
        setIsLoadingAdminHolidays(true);
        const requestId = adminHolidayRequestRef.current + 1;
        adminHolidayRequestRef.current = requestId;
        fetchHolidayEntries(adminDefaultCode)
          .then((entries) => {
            if (adminHolidayRequestRef.current !== requestId) {
              return;
            }
            holidayCacheRef.current.set(adminDefaultCode, entries);
            setAdminHolidayEntries(entries);
          })
          .catch((error) => {
            console.error(error);
            if (adminHolidayRequestRef.current !== requestId) {
              return;
            }
            setHolidayAdminError(
              error instanceof Error
                ? error.message
                : "공휴일 정보를 불러오지 못했습니다.",
            );
          })
          .finally(() => {
            if (adminHolidayRequestRef.current === requestId) {
              setIsLoadingAdminHolidays(false);
            }
          });
      }
    }

    setHolidayForm({ id: null, date: "", weekday: "", name: "", note: "" });
  }, [
    organizationHolidayCodes,
    holidayPreviewCalendarCode,
    initialPreviewHolidayEntries,
    sortedHolidayCalendars,
    fetchHolidayEntries,
    initialAdminCalendarCode,
  ]);

  const handleToggleOrganizationHolidayCode = (code: HolidayCalendarCode) => {
    const next = organizationHolidayCodes.includes(code)
      ? organizationHolidayCodes.filter((value) => value !== code)
      : (() => {
          const updated = [...organizationHolidayCodes, code];
          const order = new Map<HolidayCalendarCode, number>();
          sortedHolidayCalendars.forEach((calendar, index) => {
            order.set(calendar.code, index);
          });
          return updated.sort((a, b) => {
            const indexA = order.get(a) ?? Number.MAX_SAFE_INTEGER;
            const indexB = order.get(b) ?? Number.MAX_SAFE_INTEGER;
            return indexA - indexB;
          });
        })();
    onOrganizationHolidayCodesChange(next);
  };

  const resetHolidayForm = () => {
    setHolidayForm({ id: null, date: "", weekday: "", name: "", note: "" });
  };

  const handleAdminCalendarSelect = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const code = event.target.value as HolidayCalendarCode;
    setAdminCalendarCode(code);
    setHolidayAdminError(null);
    setHolidayAdminFeedback(null);
    resetHolidayForm();
    const requestId = adminHolidayRequestRef.current + 1;
    adminHolidayRequestRef.current = requestId;
    const cached = holidayCacheRef.current.get(code);
    if (cached) {
      setAdminHolidayEntries(cached);
      setIsLoadingAdminHolidays(false);
      return;
    }
    setIsLoadingAdminHolidays(true);

    fetchHolidayEntries(code)
      .then((entries) => {
        if (adminHolidayRequestRef.current !== requestId) {
          return;
        }
        setAdminHolidayEntries(entries);
      })
      .catch((error) => {
        console.error(error);
        if (adminHolidayRequestRef.current !== requestId) {
          return;
        }
        setHolidayAdminError(
          error instanceof Error
            ? error.message
            : "공휴일 정보를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (adminHolidayRequestRef.current === requestId) {
          setIsLoadingAdminHolidays(false);
        }
      });
  };

  const handleHolidayFormChange =
    (field: keyof HolidayFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setHolidayForm((previous) => ({
        ...previous,
        [field]: value,
      }));
    };

  const handleEditHoliday = (entry: CalendarHoliday) => {
    setHolidayAdminError(null);
    setHolidayAdminFeedback(null);
    setHolidayForm({
      id: entry.id,
      date: entry.holidayDate,
      weekday: entry.weekday ?? "",
      name: entry.name,
      note: entry.note ?? "",
    });
  };

  const handleCancelHolidayEdit = () => {
    resetHolidayForm();
    setHolidayAdminError(null);
    setHolidayAdminFeedback(null);
  };

  const handleHolidayFormSubmit = () => {
    const targetCalendar = adminCalendarCode;
    const trimmedDate = holidayForm.date.trim();
    const trimmedName = holidayForm.name.trim();
    const trimmedWeekday = holidayForm.weekday.trim();
    const trimmedNote = holidayForm.note.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      setHolidayAdminError("날짜는 YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }

    if (!trimmedName.length) {
      setHolidayAdminError("공휴일 이름을 입력해 주세요.");
      return;
    }

    setHolidayAdminError(null);
    setHolidayAdminFeedback(null);
    setIsLoadingAdminHolidays(true);
    const requestId = adminHolidayRequestRef.current + 1;
    adminHolidayRequestRef.current = requestId;

    startMutatingHoliday(async () => {
      try {
        holidayCacheRef.current.delete(targetCalendar);
        const payloadBody = JSON.stringify({
          calendarCode: targetCalendar,
          holidayDate: trimmedDate,
          weekday: trimmedWeekday || undefined,
          name: trimmedName,
          note: trimmedNote || undefined,
        });

        if (holidayForm.id) {
          const response = await fetch(
            `/api/holidays/entries/${holidayForm.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: payloadBody,
            },
          );
          const payload = await parseHolidayResponse(response);
          if (!response.ok || !payload.success || !payload.holiday) {
            throw new Error(payload.message ?? "공휴일을 수정하지 못했습니다.");
          }
          setHolidayAdminFeedback("공휴일을 수정했어요.");
        } else {
          const response = await fetch(
            `/api/holidays/calendars/${encodeURIComponent(targetCalendar)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payloadBody,
            },
          );
          const payload = await parseHolidayResponse(response);
          if (!response.ok || !payload.success || !payload.holiday) {
            throw new Error(payload.message ?? "공휴일을 추가하지 못했습니다.");
          }
          setHolidayAdminFeedback("공휴일을 추가했어요.");
        }

        const updatedEntries = await fetchHolidayEntries(targetCalendar);
        setAdminHolidayEntries(updatedEntries);
        resetHolidayForm();
      } catch (error) {
        console.error(error);
        setHolidayAdminError(
          error instanceof Error
            ? error.message
            : "공휴일 정보를 저장하지 못했습니다.",
        );
      } finally {
        if (adminHolidayRequestRef.current === requestId) {
          setIsLoadingAdminHolidays(false);
        }
      }
    });
  };

  const handleDeleteHoliday = (holidayId: number) => {
    const targetCalendar = adminCalendarCode;
    setHolidayAdminError(null);
    setHolidayAdminFeedback(null);
    setIsLoadingAdminHolidays(true);
    const requestId = adminHolidayRequestRef.current + 1;
    adminHolidayRequestRef.current = requestId;

    startMutatingHoliday(async () => {
      try {
        holidayCacheRef.current.delete(targetCalendar);
        const response = await fetch(`/api/holidays/entries/${holidayId}`, {
          method: "DELETE",
        });
        const payload = await parseHolidayResponse(response);
        if (!response.ok || !payload.success) {
          throw new Error(payload.message ?? "공휴일을 삭제하지 못했습니다.");
        }

        const updatedEntries = await fetchHolidayEntries(targetCalendar);
        setAdminHolidayEntries(updatedEntries);
        if (holidayForm.id === holidayId) {
          resetHolidayForm();
        }
        setHolidayAdminFeedback("공휴일을 삭제했어요.");
      } catch (error) {
        console.error(error);
        setHolidayAdminError(
          error instanceof Error
            ? error.message
            : "공휴일을 삭제하지 못했습니다.",
        );
      } finally {
        if (adminHolidayRequestRef.current === requestId) {
          setIsLoadingAdminHolidays(false);
        }
      }
    });
  };

  return (
    <>
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>조직 공휴일</CardTitle>
          <CardDescription>
            조직 전체 지표 계산에서 제외할 공휴일 달력을 선택하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            {sortedHolidayCalendars.map((calendar) => {
              const checkboxId = `organization-calendar-${calendar.code}`;
              const isChecked = organizationHolidayCodes.includes(
                calendar.code,
              );
              const cachedEntries = holidayCacheRef.current.get(calendar.code);
              const count = cachedEntries?.length ?? calendar.holidayCount ?? 0;

              return (
                <label
                  key={calendar.code}
                  htmlFor={checkboxId}
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm shadow-sm transition",
                    isChecked
                      ? "border-primary/70 ring-1 ring-primary/30"
                      : "hover:border-border",
                    !canEditOrganization && "opacity-60",
                  )}
                >
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus-visible:ring-primary"
                    checked={isChecked}
                    onChange={() =>
                      handleToggleOrganizationHolidayCode(calendar.code)
                    }
                    disabled={!canEditOrganization}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {calendar.label}
                      {count ? ` · ${count.toLocaleString()}일` : ""}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            선택한 달력은 Activity 및 Follow-ups 메뉴의 업무일 계산에도
            적용돼요.
          </p>
        </CardContent>
      </Card>

      {canEditOrganization ? (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>공휴일 관리</CardTitle>
            <CardDescription>
              국가별 공휴일 정보를 추가, 수정, 삭제할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <label className="flex flex-col gap-2">
              <span className="text-muted-foreground">관리할 국가</span>
              <select
                value={adminCalendarCode}
                onChange={handleAdminCalendarSelect}
                className="rounded-md border border-border/60 bg-background p-2 text-sm"
                disabled={!canEditOrganization}
              >
                {sortedHolidayCalendars.map((calendar) => {
                  const cachedEntries = holidayCacheRef.current.get(
                    calendar.code,
                  );
                  const count =
                    cachedEntries?.length ?? calendar.holidayCount ?? 0;
                  return (
                    <option key={calendar.code} value={calendar.code}>
                      {calendar.label}
                      {count ? ` · ${count.toLocaleString()}일` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            {holidayAdminError ? (
              <p className="text-xs text-rose-600">{holidayAdminError}</p>
            ) : null}
            {holidayAdminFeedback ? (
              <p className="text-xs text-emerald-600">{holidayAdminFeedback}</p>
            ) : null}
            <div className="overflow-hidden rounded-md border border-border/60">
              {isLoadingAdminHolidays ? (
                <p className="p-4 text-sm text-muted-foreground">
                  공휴일 목록을 불러오는 중입니다...
                </p>
              ) : adminHolidayEntries.length ? (
                <table className="min-w-full divide-y divide-border/80 text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">날짜</th>
                      <th className="px-3 py-2 text-left font-medium">요일</th>
                      <th className="px-3 py-2 text-left font-medium">
                        공휴일명
                      </th>
                      <th className="px-3 py-2 text-left font-medium">비고</th>
                      <th className="px-3 py-2 text-right font-medium">작업</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 bg-background">
                    {adminHolidayEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={cn({
                          "bg-primary/5": holidayForm.id === entry.id,
                        })}
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {entry.holidayDate}
                        </td>
                        <td className="px-3 py-2">{entry.weekday ?? "-"}</td>
                        <td className="px-3 py-2">{entry.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.note ?? "-"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditHoliday(entry)}
                              disabled={isMutatingHoliday}
                            >
                              수정
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteHoliday(entry.id)}
                              disabled={isMutatingHoliday}
                            >
                              삭제
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  등록된 공휴일이 없습니다.
                </p>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="flex flex-col gap-2">
                <label
                  className="text-muted-foreground"
                  htmlFor={holidayDateInputId}
                >
                  날짜
                </label>
                <PickerInput
                  id={holidayDateInputId}
                  value={holidayForm.date}
                  onChange={handleHolidayFormChange("date")}
                  maxLength={10}
                  pickerButtonLabel="달력 열기"
                />
              </div>
              <label
                className="flex flex-col gap-2"
                htmlFor={holidayWeekdayInputId}
              >
                <span className="text-muted-foreground">요일</span>
                <Input
                  id={holidayWeekdayInputId}
                  value={holidayForm.weekday}
                  onChange={handleHolidayFormChange("weekday")}
                  placeholder="예: 월"
                />
              </label>
              <label
                className="md:col-span-2 flex flex-col gap-2"
                htmlFor={holidayNameInputId}
              >
                <span className="text-muted-foreground">공휴일명</span>
                <Input
                  id={holidayNameInputId}
                  value={holidayForm.name}
                  onChange={handleHolidayFormChange("name")}
                  placeholder="공휴일 이름"
                />
              </label>
              <label
                className="md:col-span-4 flex flex-col gap-2"
                htmlFor={holidayNoteInputId}
              >
                <span className="text-muted-foreground">비고</span>
                <textarea
                  id={holidayNoteInputId}
                  value={holidayForm.note}
                  onChange={handleHolidayFormChange("note")}
                  rows={2}
                  className="w-full rounded-md border border-border/60 bg-background p-2 text-sm"
                  placeholder="추가 정보가 있다면 입력하세요."
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleHolidayFormSubmit}
                disabled={isMutatingHoliday}
              >
                {isMutatingHoliday
                  ? "저장 중..."
                  : holidayForm.id
                    ? "공휴일 수정"
                    : "공휴일 추가"}
              </Button>
              {holidayForm.id ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancelHolidayEdit}
                  disabled={isMutatingHoliday}
                >
                  취소
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
