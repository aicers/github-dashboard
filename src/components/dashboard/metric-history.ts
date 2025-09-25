import type { MetricHistoryEntry, PeriodKey } from "@/lib/dashboard/types";

export const HISTORY_KEYS: PeriodKey[] = [
  "previous4",
  "previous3",
  "previous2",
  "previous",
  "current",
];

export const HISTORY_LABELS: Record<PeriodKey, string> = {
  previous4: "4회 전",
  previous3: "3회 전",
  previous2: "2회 전",
  previous: "이전",
  current: "이번",
};

export function toCardHistory(series?: MetricHistoryEntry[]) {
  return HISTORY_KEYS.map((period) => ({
    period,
    label: HISTORY_LABELS[period],
    value: series?.find((entry) => entry.period === period)?.value ?? null,
  }));
}
