import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DateTime } from "luxon";
import type { ChangeEvent } from "react";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type MutableRefObject,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import { Input } from "./input";

type PickerType = "date" | "datetime-local" | "month";

type PickerInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  type?: PickerType;
  wrapperClassName?: string;
  iconClassName?: string;
  iconButtonClassName?: string;
  pickerButtonLabel?: string;
  onValueChange?: (value: string) => void;
};

const WEEKDAY_LABELS = [
  { key: "sun", label: "S" },
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
] as const;

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as MutableRefObject<T>).current = value;
}

function formatLocalValue(type: PickerType): string {
  const now = new Date();
  const offsetMinutes = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offsetMinutes * 60 * 1000);
  if (type === "datetime-local") {
    return local.toISOString().slice(0, 16);
  }
  if (type === "month") {
    return local.toISOString().slice(0, 7);
  }
  return local.toISOString().slice(0, 10);
}

function toStringValue(
  value: string | number | readonly string[] | null | undefined,
): string {
  if (Array.isArray(value)) {
    return value.length ? String(value[0]) : "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function parseIsoDate(
  value: string | number | readonly string[] | undefined | null,
) {
  const trimmed = toStringValue(value).trim();
  if (!trimmed) {
    return null;
  }
  const parsed = DateTime.fromISO(trimmed);
  return parsed.isValid ? parsed : null;
}

function getTimeValue(
  value: string | number | readonly string[] | undefined | null,
) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return "00:00";
  }
  return parsed.toFormat("HH:mm");
}

function applyTimeToDate(date: DateTime, timeString: string) {
  const [hours, minutes] = timeString.split(":");
  const hourValue = Number.parseInt(hours ?? "0", 10);
  const minuteValue = Number.parseInt(minutes ?? "0", 10);
  return date.set({
    hour: Number.isFinite(hourValue) ? hourValue : 0,
    minute: Number.isFinite(minuteValue) ? minuteValue : 0,
  });
}

function formatForInput(date: DateTime, type: PickerType, timeString: string) {
  if (type === "datetime-local") {
    const withTime = applyTimeToDate(date, timeString);
    return withTime.toFormat("yyyy-LL-dd'T'HH:mm");
  }
  if (type === "month") {
    return date.toFormat("yyyy-LL");
  }
  return date.toISODate();
}

function buildSyntheticEvent(
  target: HTMLInputElement,
  value: string,
): React.ChangeEvent<HTMLInputElement> {
  const event = {
    target,
    currentTarget: target,
  } as React.ChangeEvent<HTMLInputElement>;
  event.target.value = value;
  event.currentTarget.value = value;
  return event;
}

export const PickerInput = forwardRef<HTMLInputElement, PickerInputProps>(
  (
    {
      type = "date",
      className,
      wrapperClassName,
      iconClassName,
      iconButtonClassName,
      pickerButtonLabel,
      disabled,
      lang,
      onChange,
      onValueChange,
      ...props
    },
    forwardedRef,
  ) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef],
    );

    const useCustomPanel = type === "date" || type === "datetime-local";

    const resolvedButtonLabel = useMemo(() => {
      if (pickerButtonLabel) {
        return pickerButtonLabel;
      }
      if (type === "datetime-local") {
        return "날짜와 시간을 선택하세요";
      }
      if (type === "month") {
        return "월을 선택하세요";
      }
      return "날짜를 선택하세요";
    }, [pickerButtonLabel, type]);

    const ensureDefaultValue = useCallback(() => {
      const target = inputRef.current;
      if (!target || target.value) {
        return;
      }
      const fallback = formatLocalValue(type);
      target.value = fallback;
      const event = new Event("input", { bubbles: true });
      target.dispatchEvent(event);
    }, [type]);

    const [isCalendarOpen, setCalendarOpen] = useState(false);
    const [calendarMonth, setCalendarMonth] = useState(() => {
      const parsed = parseIsoDate(props.value);
      return parsed ?? DateTime.local();
    });
    const [timeValue, setTimeValue] = useState(() =>
      type === "datetime-local" ? getTimeValue(props.value) : "00:00",
    );
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const parsed = parseIsoDate(props.value);
      if (parsed) {
        setCalendarMonth(parsed);
        if (type === "datetime-local") {
          setTimeValue(parsed.toFormat("HH:mm"));
        }
      }
    }, [props.value, type]);

    useEffect(() => {
      if (!isCalendarOpen) {
        return;
      }
      const handleClickOutside = (event: MouseEvent) => {
        const panel = panelRef.current;
        const wrapper = wrapperRef.current;
        if (
          panel &&
          wrapper &&
          event.target instanceof Node &&
          !panel.contains(event.target) &&
          !wrapper.contains(event.target)
        ) {
          setCalendarOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [isCalendarOpen]);

    const handleSelectDate = useCallback(
      (date: DateTime, overrideTime?: string) => {
        const targetTime =
          type === "datetime-local" ? (overrideTime ?? timeValue) : timeValue;
        const iso = formatForInput(date, type, targetTime);
        const target = inputRef.current;
        if (!target || !iso) {
          return;
        }
        target.value = iso;
        const synthetic = buildSyntheticEvent(target, iso);
        onChange?.(synthetic);
        onValueChange?.(iso);
        setCalendarOpen(false);
      },
      [onChange, onValueChange, timeValue, type],
    );

    const handleClearDate = useCallback(() => {
      const target = inputRef.current;
      if (!target) {
        return;
      }
      target.value = "";
      const synthetic = buildSyntheticEvent(target, "");
      onChange?.(synthetic);
      onValueChange?.("");
      setCalendarOpen(false);
      if (type === "datetime-local") {
        setTimeValue("00:00");
      }
    }, [onChange, onValueChange, type]);

    const handleTextChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange?.(event);
        onValueChange?.(event.currentTarget.value);
      },
      [onChange, onValueChange],
    );

    const handleTimeChange = useCallback(
      (value: string) => {
        setTimeValue(value);
        const target = inputRef.current;
        const datePart = parseIsoDate(target?.value ?? "");
        if (!target || !datePart) {
          return;
        }
        handleSelectDate(datePart, value);
      },
      [handleSelectDate],
    );

    const handleOpenPicker = useCallback(() => {
      if (disabled) {
        return;
      }
      if (useCustomPanel) {
        setCalendarOpen((current) => !current);
        return;
      }
      const target = inputRef.current;
      if (!target) {
        return;
      }
      ensureDefaultValue();
      try {
        if (typeof target.showPicker === "function") {
          target.showPicker();
          return;
        }
      } catch {
        // Safari can throw if showPicker runs while hidden; ignore.
      }
      target.focus();
      target.click();
    }, [disabled, ensureDefaultValue, useCustomPanel]);

    const selectedDate = useMemo(
      () => parseIsoDate(props.value),
      [props.value],
    );

    const renderCalendar = () => {
      const startOfMonth = calendarMonth.startOf("month");
      const startOfGrid = startOfMonth.startOf("week");
      const days: DateTime[] = [];
      for (let index = 0; index < 42; index += 1) {
        days.push(startOfGrid.plus({ days: index }));
      }
      const monthLabel = calendarMonth.toFormat("MMMM yyyy");

      return (
        <div
          ref={panelRef}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-lg border border-border/70 bg-background p-3 text-sm shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() =>
                setCalendarMonth((month) => month.minus({ months: 1 }))
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold">{monthLabel}</span>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() =>
                setCalendarMonth((month) => month.plus({ months: 1 }))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-xs font-semibold text-muted-foreground">
            {WEEKDAY_LABELS.map((day) => (
              <span key={day.key} className="text-center">
                {day.label}
              </span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1 text-sm">
            {days.map((day) => {
              const isCurrentMonth = day.month === calendarMonth.month;
              const isSelected =
                selectedDate &&
                day.hasSame(selectedDate, "day") &&
                day.hasSame(selectedDate, "month") &&
                day.hasSame(selectedDate, "year");
              return (
                <button
                  type="button"
                  key={day.toISODate()}
                  onClick={() => handleSelectDate(day)}
                  className={cn(
                    "aspect-square rounded-md text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : isCurrentMonth
                        ? "text-foreground hover:bg-muted/70"
                        : "text-muted-foreground",
                  )}
                >
                  {day.day}
                </button>
              );
            })}
          </div>
          {type === "datetime-local" ? (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <span>시간</span>
                <input
                  type="time"
                  value={timeValue}
                  onChange={(event) => handleTimeChange(event.target.value)}
                  className="rounded-md border border-border/60 bg-background px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  const now = DateTime.local();
                  const nowTime = now.toFormat("HH:mm");
                  setTimeValue(nowTime);
                  handleSelectDate(now, nowTime);
                }}
              >
                지금
              </button>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClearDate}
            >
              Clear
            </button>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                const now = DateTime.local();
                if (type === "datetime-local") {
                  const nowTime = now.toFormat("HH:mm");
                  setTimeValue(nowTime);
                  handleSelectDate(now, nowTime);
                  return;
                }
                handleSelectDate(now);
              }}
            >
              Today
            </button>
          </div>
        </div>
      );
    };

    if (useCustomPanel) {
      return (
        <div
          ref={wrapperRef}
          className={cn("relative inline-flex w-full", wrapperClassName)}
        >
          <div className="inline-flex w-full overflow-hidden rounded-md border border-border/60 bg-background">
            <Input
              {...props}
              ref={setRefs}
              type="text"
              disabled={disabled}
              lang={lang ?? "ko-KR"}
              onChange={handleTextChange}
              className={cn(
                "picker-input min-w-0 border-0 pr-3 focus-visible:z-10",
                className,
              )}
            />
            <button
              type="button"
              onClick={handleOpenPicker}
              aria-label={resolvedButtonLabel}
              className={cn(
                "inline-flex items-center justify-center border-l border-border/60 bg-transparent px-2 text-foreground transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
                iconButtonClassName,
              )}
              disabled={disabled}
            >
              <CalendarIcon
                aria-hidden="true"
                className={cn("h-4 w-4", iconClassName)}
              />
            </button>
          </div>
          {isCalendarOpen ? renderCalendar() : null}
        </div>
      );
    }

    return (
      <div
        className={cn(
          "inline-flex w-full overflow-hidden rounded-md border border-border/60 bg-background",
          wrapperClassName,
        )}
      >
        <Input
          {...props}
          ref={setRefs}
          type={type}
          disabled={disabled}
          lang={lang ?? "ko-KR"}
          className={cn(
            "picker-input min-w-0 border-0 pr-3 focus-visible:z-10",
            className,
          )}
          onChange={handleTextChange}
        />
        <button
          type="button"
          onClick={handleOpenPicker}
          aria-label={resolvedButtonLabel}
          className={cn(
            "inline-flex items-center justify-center border-l border-border/60 bg-transparent px-2 text-foreground transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            iconButtonClassName,
          )}
          disabled={disabled}
        >
          <CalendarIcon
            aria-hidden="true"
            className={cn("h-4 w-4", iconClassName)}
          />
        </button>
      </div>
    );
  },
);

PickerInput.displayName = "PickerInput";
