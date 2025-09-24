"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

function getTimezoneOptions() {
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

  return FALLBACK_TIMEZONES;
}

type SettingsViewProps = {
  orgName: string;
  syncIntervalMinutes: number;
  timeZone: string;
  weekStart: "sunday" | "monday";
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
};

export function SettingsView({
  orgName,
  syncIntervalMinutes,
  timeZone,
  weekStart,
}: SettingsViewProps) {
  const router = useRouter();
  const [name, setName] = useState(orgName);
  const [interval, setInterval] = useState(syncIntervalMinutes.toString());
  const [timezone, setTimezone] = useState(timeZone);
  const [weekStartValue, setWeekStartValue] = useState<"sunday" | "monday">(
    weekStart,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const orgInputId = useId();
  const intervalInputId = useId();

  const timezones = useMemo(() => {
    const options = getTimezoneOptions();
    if (options.includes(timezone)) {
      return options;
    }

    return [timezone, ...options];
  }, [timezone]);

  const handleSave = () => {
    startSaving(async () => {
      try {
        const parsedInterval = Number.parseInt(interval, 10);
        if (Number.isNaN(parsedInterval) || parsedInterval <= 0) {
          throw new Error("동기화 주기는 1 이상의 정수여야 합니다.");
        }

        if (!name.trim()) {
          throw new Error("Organization 이름을 입력하세요.");
        }

        const response = await fetch("/api/sync/config", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orgName: name.trim(),
            syncIntervalMinutes: parsedInterval,
            timezone,
            weekStart: weekStartValue,
          }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (!data.success) {
          throw new Error(data.message ?? "설정을 저장하지 못했습니다.");
        }

        setFeedback("설정이 저장되었습니다.");
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "설정 저장 중 오류가 발생했습니다.",
        );
      }
    });
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          동기화 대상과 시간대를 조정하여 통합 지표의 기준을 맞추세요.
        </p>
        {feedback && <p className="text-sm text-primary">{feedback}</p>}
      </header>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Organization & 동기화</CardTitle>
          <CardDescription>
            GitHub Organization 이름과 자동 동기화 주기를 관리합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm" htmlFor={orgInputId}>
            <span className="text-muted-foreground">Organization 이름</span>
            <Input
              id={orgInputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-organization"
            />
          </label>
          <label
            className="flex flex-col gap-2 text-sm"
            htmlFor={intervalInputId}
          >
            <span className="text-muted-foreground">자동 동기화 주기 (분)</span>
            <Input
              id={intervalInputId}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              type="number"
              min={1}
            />
          </label>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>시간대 (Timezone)</CardTitle>
          <CardDescription>
            대시보드의 날짜/시간 계산에 사용할 표준 시간대를 선택하세요.
          </CardDescription>
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
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "저장 중..." : "설정 저장"}
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
