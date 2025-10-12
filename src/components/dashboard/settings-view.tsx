"use client";

import { Building2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";

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
import {
  DATE_TIME_FORMAT_OPTIONS,
  type DateTimeDisplayFormat,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";
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

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 수정할 수 있습니다.";

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
  dateTimeFormat: string;
  repositories: RepositoryProfile[];
  excludedRepositoryIds: string[];
  members: UserProfile[];
  excludedMemberIds: string[];
  isAdmin: boolean;
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
  dateTimeFormat,
  repositories,
  excludedRepositoryIds,
  members,
  excludedMemberIds,
  isAdmin,
}: SettingsViewProps) {
  const router = useRouter();
  const [name, setName] = useState(orgName);
  const [interval, setInterval] = useState(syncIntervalMinutes.toString());
  const [timezone, setTimezone] = useState(timeZone);
  const [weekStartValue, setWeekStartValue] = useState<"sunday" | "monday">(
    weekStart,
  );
  const [dateTimeFormatValue, setDateTimeFormatValue] =
    useState<DateTimeDisplayFormat>(
      normalizeDateTimeDisplayFormat(dateTimeFormat),
    );
  const [personalFeedback, setPersonalFeedback] = useState<string | null>(null);
  const [orgFeedback, setOrgFeedback] = useState<string | null>(null);
  const normalizedExcludedRepositories = useMemo(() => {
    const allowed = new Set(repositories.map((repo) => repo.id));
    return excludedRepositoryIds.filter((id) => allowed.has(id));
  }, [excludedRepositoryIds, repositories]);
  const [excludedRepos, setExcludedRepos] = useState<string[]>(
    normalizedExcludedRepositories,
  );
  const normalizedExcludedMembers = useMemo(() => {
    const allowed = new Set(members.map((member) => member.id));
    return excludedMemberIds.filter((id) => allowed.has(id));
  }, [excludedMemberIds, members]);
  const [excludedPeople, setExcludedPeople] = useState<string[]>(
    normalizedExcludedMembers,
  );
  const [isSavingPersonal, startSavingPersonal] = useTransition();
  const [isSavingOrganization, startSavingOrganization] = useTransition();
  const [activeTab, setActiveTab] = useState<"personal" | "organization">(
    "personal",
  );
  const orgInputId = useId();
  const intervalInputId = useId();
  const excludeSelectId = useId();
  const excludePeopleSelectId = useId();

  const canEditOrganization = isAdmin;

  const timezones = useMemo(() => {
    const options = getTimezoneOptions();
    if (options.includes(timezone)) {
      return options;
    }

    return [timezone, ...options];
  }, [timezone]);

  useEffect(() => {
    setExcludedRepos(normalizedExcludedRepositories);
  }, [normalizedExcludedRepositories]);

  useEffect(() => {
    setExcludedPeople(normalizedExcludedMembers);
  }, [normalizedExcludedMembers]);

  useEffect(() => {
    setDateTimeFormatValue(normalizeDateTimeDisplayFormat(dateTimeFormat));
  }, [dateTimeFormat]);

  const sortedRepositories = useMemo(() => {
    return [...repositories].sort((a, b) => {
      const nameA = a.nameWithOwner ?? a.name ?? a.id;
      const nameB = b.nameWithOwner ?? b.name ?? b.id;
      return nameA.localeCompare(nameB);
    });
  }, [repositories]);

  const sortedMembers = useMemo(() => {
    const toLabel = (member: UserProfile) =>
      member.login ?? member.name ?? member.id;
    return [...members].sort((a, b) =>
      toLabel(a).localeCompare(toLabel(b), undefined, {
        sensitivity: "base",
      }),
    );
  }, [members]);

  const handleExcludedChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const selected = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    setExcludedRepos(selected);
  };

  const handleClearExcluded = () => {
    setExcludedRepos([]);
  };

  const handleExcludedPeopleChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const selected = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    setExcludedPeople(selected);
  };

  const handleClearExcludedPeople = () => {
    setExcludedPeople([]);
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

  const handleSaveOrganization = () => {
    if (!canEditOrganization) {
      setOrgFeedback(ADMIN_ONLY_MESSAGE);
      return;
    }

    setOrgFeedback(null);
    startSavingOrganization(async () => {
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
            dateTimeFormat: dateTimeFormatValue,
            excludedRepositories: excludedRepos,
            excludedPeople,
          }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (!data.success) {
          throw new Error(data.message ?? "설정을 저장하지 못했습니다.");
        }

        setOrgFeedback("설정이 저장되었습니다.");
        router.refresh();
      } catch (error) {
        setOrgFeedback(
          error instanceof Error
            ? error.message
            : "설정 저장 중 오류가 발생했습니다.",
        );
      }
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          각 구성원과 전체 조직 관련 사항을 설정합니다.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <nav
          className="border-b border-border/80"
          aria-label="Settings 하위 메뉴"
        >
          <div className="flex gap-1 overflow-x-auto">
            {(
              [
                {
                  id: "personal",
                  label: "Personal",
                  icon: <User className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  id: "organization",
                  label: "Organization",
                  icon: <Building2 className="h-4 w-4" aria-hidden="true" />,
                },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={isActive ? "true" : undefined}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        {activeTab === "personal" ? (
          <section className="flex flex-col gap-4">
            {personalFeedback && (
              <p className="text-sm text-primary">{personalFeedback}</p>
            )}

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
                      setWeekStartValue(
                        event.target.value as "sunday" | "monday",
                      )
                    }
                    className="rounded-md border border-border/60 bg-background p-2 text-sm"
                  >
                    <option value="monday">월요일 시작</option>
                    <option value="sunday">일요일 시작</option>
                  </select>
                </label>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>화면 표시</CardTitle>
                <CardDescription>
                  대시보드에 노출되는 날짜와 시간 형식을 선택하세요.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <label className="flex flex-col gap-2">
                  <span className="text-muted-foreground">날짜와 시간</span>
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
              </CardContent>
            </Card>
            <div className="flex justify-end">
              <Button onClick={handleSavePersonal} disabled={isSavingPersonal}>
                {isSavingPersonal ? "저장 중..." : "개인 설정 저장"}
              </Button>
            </div>
          </section>
        ) : null}

        {activeTab === "organization" ? (
          <section className="flex flex-col gap-4">
            {!canEditOrganization && (
              <p className="text-sm text-muted-foreground">
                {ADMIN_ONLY_MESSAGE}
              </p>
            )}
            {orgFeedback && (
              <p className="text-sm text-primary">{orgFeedback}</p>
            )}

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Organization & 동기화</CardTitle>
                <CardDescription>
                  GitHub Organization 이름과 자동 동기화 주기를 관리합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <label
                  className="flex flex-col gap-2 text-sm"
                  htmlFor={orgInputId}
                >
                  <span className="text-muted-foreground">
                    Organization 이름
                  </span>
                  <Input
                    id={orgInputId}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="my-organization"
                    disabled={!canEditOrganization}
                    title={
                      !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                    }
                  />
                </label>
                <label
                  className="flex flex-col gap-2 text-sm"
                  htmlFor={intervalInputId}
                >
                  <span className="text-muted-foreground">
                    자동 동기화 주기 (분)
                  </span>
                  <Input
                    id={intervalInputId}
                    value={interval}
                    onChange={(event) => setInterval(event.target.value)}
                    type="number"
                    min={1}
                    disabled={!canEditOrganization}
                    title={
                      !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                    }
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-muted-foreground">표준 시간대</span>
                    <select
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                      className="rounded-md border border-border/60 bg-background p-2 text-sm"
                      disabled={!canEditOrganization}
                      title={
                        !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                      }
                    >
                      {timezones.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-muted-foreground">
                      주의 시작 요일
                    </span>
                    <select
                      value={weekStartValue}
                      onChange={(event) =>
                        setWeekStartValue(
                          event.target.value as "sunday" | "monday",
                        )
                      }
                      className="rounded-md border border-border/60 bg-background p-2 text-sm"
                      disabled={!canEditOrganization}
                      title={
                        !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                      }
                    >
                      <option value="monday">월요일 시작</option>
                      <option value="sunday">일요일 시작</option>
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-muted-foreground">날짜와 시간</span>
                  <select
                    value={dateTimeFormatValue}
                    onChange={(event) =>
                      setDateTimeFormatValue(
                        normalizeDateTimeDisplayFormat(event.target.value),
                      )
                    }
                    className="rounded-md border border-border/60 bg-background p-2 text-sm"
                    disabled={!canEditOrganization}
                    title={
                      !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                    }
                  >
                    {DATE_TIME_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                        {option.example ? ` · ${option.example}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>리포지토리 제외</CardTitle>
                <CardDescription>
                  제외된 리포지토리는 Analytics와 People 메뉴의 필터 목록에
                  표시되지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {sortedRepositories.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    동기화된 리포지토리가 없습니다.
                  </p>
                ) : (
                  <label
                    className="flex flex-col gap-2"
                    htmlFor={excludeSelectId}
                  >
                    <span className="text-muted-foreground">
                      제외할 리포지토리를 선택하세요
                    </span>
                    <select
                      id={excludeSelectId}
                      multiple
                      value={excludedRepos}
                      onChange={handleExcludedChange}
                      className="h-48 rounded-md border border-border/60 bg-background p-2 text-sm"
                      disabled={!canEditOrganization}
                      title={
                        !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                      }
                    >
                      {sortedRepositories.map((repo) => (
                        <option key={repo.id} value={repo.id}>
                          {repo.nameWithOwner ?? repo.name ?? repo.id}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      여러 리포지토리를 선택하려면 ⌘/Ctrl 키를 눌러 복수
                      선택하세요.
                    </span>
                  </label>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                <span className="text-xs text-muted-foreground">
                  제외된 리포지토리: {excludedRepos.length}개
                </span>
                <Button
                  variant="secondary"
                  onClick={handleClearExcluded}
                  disabled={!canEditOrganization || !excludedRepos.length}
                  title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
                >
                  제외 목록 비우기
                </Button>
              </CardFooter>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>구성원 제외</CardTitle>
                <CardDescription>
                  제외된 구성원은 Analytics와 People 메뉴에 표시되지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {sortedMembers.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    동기화된 구성원이 없습니다.
                  </p>
                ) : (
                  <label
                    className="flex flex-col gap-2"
                    htmlFor={excludePeopleSelectId}
                  >
                    <span className="text-muted-foreground">
                      제외할 구성원을 선택하세요
                    </span>
                    <select
                      id={excludePeopleSelectId}
                      multiple
                      value={excludedPeople}
                      onChange={handleExcludedPeopleChange}
                      className="h-48 rounded-md border border-border/60 bg-background p-2 text-sm"
                      disabled={!canEditOrganization}
                      title={
                        !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                      }
                    >
                      {sortedMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.login ?? member.name ?? member.id}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      여러 구성원을 선택하려면 ⌘/Ctrl 키를 눌러 복수 선택하세요.
                    </span>
                  </label>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                <span className="text-xs text-muted-foreground">
                  제외된 구성원: {excludedPeople.length}명
                </span>
                <Button
                  variant="secondary"
                  onClick={handleClearExcludedPeople}
                  disabled={!canEditOrganization || !excludedPeople.length}
                  title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
                >
                  제외 목록 비우기
                </Button>
              </CardFooter>
            </Card>

            <div className="flex justify-end">
              <Button
                onClick={handleSaveOrganization}
                disabled={!canEditOrganization || isSavingOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              >
                {isSavingOrganization ? "저장 중..." : "조직 설정 저장"}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
