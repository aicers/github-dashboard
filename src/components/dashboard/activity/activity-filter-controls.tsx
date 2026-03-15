"use client";

import { Bot, type LucideIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActivitySavedFilter } from "@/lib/activity/types";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import type { MultiSelectOption } from "./activity-utils";
import { formatDateTime } from "./detail-shared";

// ─── MultiSelectInput ────────────────────────────────────────────────────────

export function MultiSelectInput({
  label,
  placeholder,
  appliedValues,
  optionalValues = [],
  onChange,
  onOptionalChange,
  options,
  emptyLabel,
  disabled = false,
  tone = "default",
}: {
  label: ReactNode;
  placeholder?: string;
  appliedValues: string[];
  optionalValues?: string[];
  onChange: (next: string[]) => void;
  onOptionalChange?: (next: string[]) => void;
  options: MultiSelectOption[];
  emptyLabel?: string;
  disabled?: boolean;
  tone?: "default" | "or";
}) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsFocused(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const optionalSet = useMemo(() => new Set(optionalValues), [optionalValues]);
  const allSelectedSet = useMemo(
    () => new Set([...appliedValues, ...optionalValues]),
    [appliedValues, optionalValues],
  );

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => {
      if (allSelectedSet.has(option.value)) {
        return false;
      }
      if (!normalized.length) {
        return true;
      }
      const haystack =
        `${option.label} ${option.description ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [allSelectedSet, options, query]);

  const addValue = useCallback(
    (nextValue: string) => {
      if (disabled) {
        return;
      }
      if (allSelectedSet.has(nextValue)) {
        if (optionalSet.has(nextValue) && onOptionalChange) {
          onOptionalChange(
            optionalValues.filter((entry) => entry !== nextValue),
          );
        }
        return;
      }
      if (optionalSet.has(nextValue) && onOptionalChange) {
        onOptionalChange(optionalValues.filter((entry) => entry !== nextValue));
      }
      onChange([...appliedValues, nextValue]);
      setQuery("");
    },
    [
      allSelectedSet,
      appliedValues,
      disabled,
      onChange,
      onOptionalChange,
      optionalSet,
      optionalValues,
    ],
  );

  const removeValue = useCallback(
    (target: string) => {
      if (disabled) {
        return;
      }
      onChange(appliedValues.filter((entry) => entry !== target));
    },
    [appliedValues, disabled, onChange],
  );

  const removeOptionalValue = useCallback(
    (target: string) => {
      if (disabled || !onOptionalChange) {
        return;
      }
      onOptionalChange(optionalValues.filter((entry) => entry !== target));
    },
    [disabled, onOptionalChange, optionalValues],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === "Backspace" && !query.length && appliedValues.length) {
        event.preventDefault();
        const next = [...appliedValues];
        next.pop();
        onChange(next);
      }
      if (event.key === "Enter" && query.length) {
        event.preventDefault();
        const nextCandidate = filteredOptions[0];
        if (nextCandidate) {
          addValue(nextCandidate.value);
        }
      }
    },
    [
      addValue,
      appliedValues,
      disabled,
      filteredOptions,
      onChange,
      query.length,
    ],
  );

  const isOrTone = tone === "or";

  return (
    <div
      ref={containerRef}
      className={cn("space-y-2", disabled && "cursor-not-allowed")}
      aria-disabled={disabled}
      data-disabled={disabled ? "true" : undefined}
    >
      <Label
        className={cn(
          "text-xs font-semibold uppercase text-foreground",
          disabled && "text-muted-foreground",
        )}
      >
        {label}
      </Label>
      <div
        className={cn(
          "rounded-md border border-border bg-background px-2 py-1 text-sm",
          isFocused && !disabled && "ring-2 ring-ring",
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          {appliedValues.length === 0 && optionalValues.length === 0 && (
            <span className="text-xs text-muted-foreground/70">
              {emptyLabel ?? "미적용"}
            </span>
          )}
          {optionalValues.map((entry) => {
            const option = options.find((item) => item.value === entry);
            return (
              <span
                key={`optional-${entry}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                {option?.label ?? entry}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-muted/70"
                  onClick={() => removeOptionalValue(entry)}
                  aria-label={`Remove optional ${option?.label ?? entry}`}
                  disabled={disabled || !onOptionalChange}
                >
                  ×
                </button>
              </span>
            );
          })}
          {appliedValues.map((entry) => {
            const option = options.find((item) => item.value === entry);
            return (
              <span
                key={`applied-${entry}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs",
                  isOrTone
                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "bg-primary/10 text-primary",
                )}
              >
                {option?.label ?? entry}
                <button
                  type="button"
                  className={cn(
                    "rounded-full p-0.5",
                    isOrTone
                      ? "hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30"
                      : "hover:bg-primary/20",
                  )}
                  onClick={() => removeValue(entry)}
                  aria-label={`Remove ${option?.label ?? entry}`}
                  disabled={disabled}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (disabled) {
                return;
              }
              setIsFocused(true);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-[120px] bg-transparent px-1 py-1 outline-none"
            disabled={disabled}
          />
        </div>
      </div>
      {!disabled && isFocused && filteredOptions.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover text-sm shadow-lg">
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted"
              onClick={() => {
                addValue(option.value);
              }}
            >
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className="text-xs text-muted-foreground/70">
                  {option.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PeopleToggleList ─────────────────────────────────────────────────────────

export function PeopleToggleList({
  label,
  value,
  onChange,
  options,
  synced,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  synced: boolean;
}) {
  const optionValueSet = useMemo(
    () => new Set(options.map((option) => option.value)),
    [options],
  );
  const selectedSet = useMemo(() => new Set(value), [value]);
  const allSelected = synced && value.length === 0;

  const toggleSelection = useCallback(
    (optionValue: string) => {
      if (selectedSet.has(optionValue)) {
        onChange(value.filter((entry) => entry !== optionValue));
      } else {
        const next = [...value, optionValue];
        const covered = new Set(
          next.filter((entry) => optionValueSet.has(entry)),
        );
        if (optionValueSet.size > 0 && covered.size === optionValueSet.size) {
          onChange([]);
          return;
        }
        onChange(next);
      }
    },
    [onChange, optionValueSet, selectedSet, value],
  );

  const handleSelectAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  if (!options.length) {
    return (
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-foreground">{label}</Label>
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground/80">
          연결된 사용자가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-foreground">{label}</Label>
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-2">
        <div className="flex flex-wrap gap-2">
          <TogglePill
            active={allSelected}
            variant={allSelected ? "active" : "inactive"}
            onClick={handleSelectAll}
          >
            미적용
          </TogglePill>
          {options.map((option) => {
            const active = selectedSet.has(option.value);
            const variant = allSelected
              ? "muted"
              : active
                ? "active"
                : "inactive";
            return (
              <TogglePill
                key={option.value}
                active={active}
                variant={variant}
                onClick={() => toggleSelection(option.value)}
              >
                {option.label}
              </TogglePill>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── TogglePill ───────────────────────────────────────────────────────────────

export function TogglePill({
  active,
  children,
  onClick,
  variant,
  disabled = false,
  ariaDescribedBy,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  variant?: "active" | "inactive" | "muted";
  disabled?: boolean;
  ariaDescribedBy?: string;
}) {
  const resolvedVariant = disabled
    ? "disabled"
    : (variant ?? (active ? "active" : "inactive"));
  const variantClass =
    resolvedVariant === "active"
      ? "border-primary bg-primary/10 text-primary"
      : resolvedVariant === "muted"
        ? "border-border/60 bg-muted/15 text-muted-foreground/80 hover:border-border hover:bg-muted/25 hover:text-foreground"
        : resolvedVariant === "disabled"
          ? "border-border/60 bg-muted/15 text-muted-foreground/60 cursor-not-allowed"
          : "border-border text-foreground/80 hover:bg-muted";

  return (
    <button
      type="button"
      className={cn(
        "group rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        variantClass,
      )}
      aria-pressed={active}
      aria-describedby={ariaDescribedBy}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ─── AiFilterControl ──────────────────────────────────────────────────────────

export function AiFilterControl({
  checked,
  onToggle,
  tooltipId,
  tooltipText,
}: {
  checked: boolean;
  onToggle: () => void;
  tooltipId?: string;
  tooltipText: string;
}) {
  const buttonClass = checked
    ? "border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-500/30"
    : "bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground";

  const staticGlowClass = checked
    ? "bg-sky-500/25 opacity-70"
    : "bg-sky-500/10 opacity-0 group-hover:opacity-40";
  const pulseRingClass = checked
    ? "bg-sky-400/30 opacity-70"
    : "bg-sky-400/15 opacity-0 group-hover:opacity-45";

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={tooltipId}
        onClick={onToggle}
        className={cn(
          "group relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 transition-colors duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          buttonClass,
        )}
      >
        <span className="relative z-10">
          <Bot
            className="h-3.5 w-3.5 transition-transform duration-300 group-hover:scale-110 group-active:scale-95"
            aria-hidden="true"
          />
        </span>
        <span
          className={cn(
            "pointer-events-none absolute -inset-1 z-0 rounded-full blur-md transition duration-900",
            staticGlowClass,
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "pointer-events-none absolute -inset-0.5 z-0 rounded-full",
            pulseRingClass,
          )}
          aria-hidden="true"
          style={{
            animation: `aiPulse ${checked ? "3.1s" : "4s"} ease-out infinite`,
          }}
        />
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 w-52 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {tooltipText}
        </span>
        <span className="sr-only">
          {checked ? "AI 분류 사용 중" : "AI 분류 사용 안 함"}
        </span>
      </button>
      <style>{`
        @keyframes aiPulse {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          55% {
            transform: scale(1.4);
            opacity: 0.12;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}

// ─── QuickFilterButton ────────────────────────────────────────────────────────

export function QuickFilterButton({
  active,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  const baseClass =
    "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const stateClass = active
    ? "bg-primary/15 text-primary shadow-sm hover:bg-primary/20 hover:shadow-md hover:-translate-y-0.5"
    : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground hover:shadow-md hover:-translate-y-0.5";

  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      className={cn(baseClass, stateClass)}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

// ─── SavedFiltersManager ──────────────────────────────────────────────────────

export type SavedFiltersManagerProps = {
  open: boolean;
  mode: "manage" | "save";
  filters: ActivitySavedFilter[];
  limit: number;
  canCreate: boolean;
  busyId: string | null;
  message: string | null;
  error: string | null;
  createName: string;
  createError: string | null;
  isCreating: boolean;
  onClose: () => void;
  onCreate: () => void;
  onCreateNameChange: (value: string) => void;
  onCancelCreate: () => void;
  onApply: (filter: ActivitySavedFilter) => void;
  onRename: (filter: ActivitySavedFilter, name: string) => Promise<void>;
  onReplace: (filter: ActivitySavedFilter) => Promise<void>;
  onDelete: (filter: ActivitySavedFilter) => Promise<void>;
  timezone: string | null;
  dateTimeFormat: DateTimeDisplayFormat;
};

export const SavedFiltersManager = ({
  open,
  mode,
  filters,
  limit,
  canCreate,
  busyId,
  message,
  error,
  createName,
  createError,
  isCreating,
  onClose,
  onCreate,
  onCreateNameChange,
  onCancelCreate,
  onApply,
  onRename,
  onReplace,
  onDelete,
  timezone,
  dateTimeFormat,
}: SavedFiltersManagerProps) => {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedTimezone = timezone?.trim() ?? "";
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDrafts: Record<string, string> = {};
    filters.forEach((filter) => {
      nextDrafts[filter.id] = filter.name;
    });
    setDraftNames(nextDrafts);
  }, [filters, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode !== "save") {
      return;
    }
    const target = createInputRef.current;
    if (target) {
      target.focus();
      target.select();
    }
  }, [mode, open]);

  if (!open) {
    return null;
  }

  const handleNameChange = (filterId: string, nextName: string) => {
    setDraftNames((current) => ({
      ...current,
      [filterId]: nextName,
    }));
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-background/80 backdrop-blur">
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-3xl flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-2xl max-h-[calc(100vh-3rem)] overflow-hidden"
      >
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-foreground">필터 관리</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/80">
            <span>
              {filters.length} / {limit} 저장됨
            </span>
            <Button size="sm" variant="ghost" onClick={onClose}>
              닫기
            </Button>
          </div>
        </header>

        {message ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto min-h-0">
          {mode === "save" ? (
            <section className="mb-6 space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-semibold text-foreground">
                  현재 필터 저장
                </h4>
                <p className="text-xs text-muted-foreground/80">
                  Activity의 현재 조건을 저장해 두고 빠르게 불러올 수 있어요.
                </p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreate();
                }}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <Input
                  ref={createInputRef}
                  value={createName}
                  onChange={(event) => onCreateNameChange(event.target.value)}
                  maxLength={120}
                  placeholder="필터 이름"
                  className="h-9 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      !canCreate || !createName.trim().length || isCreating
                    }
                    className="h-8 px-3 text-xs"
                  >
                    저장
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onCancelCreate}
                    className="h-8 px-3 text-xs"
                  >
                    취소
                  </Button>
                </div>
              </form>
              {createError ? (
                <p className="text-xs text-rose-600">{createError}</p>
              ) : null}
              {!canCreate ? (
                <p className="text-xs text-amber-600">
                  최대 {limit}개의 필터를 저장할 수 있어요. 사용하지 않는 필터를
                  삭제해 주세요.
                </p>
              ) : null}
            </section>
          ) : null}
          {filters.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/10 p-6 text-center text-sm text-muted-foreground/80">
              저장된 필터가 아직 없어요. Activity에서 원하는 조건을 설정하고
              &ldquo;현재 필터 저장&rdquo;을 눌러 시작해 보세요.
            </div>
          ) : (
            <div className="space-y-4">
              {filters.map((filter) => {
                const draftName = draftNames[filter.id] ?? filter.name;
                const trimmed = draftName.trim();
                const isFilterBusy = busyId === filter.id;
                const canRename =
                  trimmed.length > 0 &&
                  trimmed !== filter.name &&
                  !isFilterBusy;
                const formattedUpdatedAt = formatDateTime(
                  filter.updatedAt,
                  timezone ?? undefined,
                  dateTimeFormat,
                );

                return (
                  <div
                    key={filter.id}
                    className="rounded-lg border border-border/60 bg-background px-4 py-3 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-1 flex-col gap-2">
                        <Input
                          value={draftName}
                          onChange={(event) =>
                            handleNameChange(filter.id, event.target.value)
                          }
                          maxLength={120}
                          className="h-9 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70">
                          <span title={timezoneTitle}>
                            마지막 수정: {formattedUpdatedAt}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={!canRename}
                          onClick={() => void onRename(filter, draftName)}
                          className="h-8 px-3 text-xs"
                        >
                          이름 저장
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void onReplace(filter)}
                          disabled={isFilterBusy}
                          className="h-8 px-3 text-xs"
                        >
                          현재 필터로 업데이트
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onApply(filter)}
                          className="h-8 px-3 text-xs"
                        >
                          필터 적용
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onDelete(filter)}
                          disabled={isFilterBusy}
                          className="h-8 px-3 text-xs text-rose-600 hover:text-rose-700"
                        >
                          삭제
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
