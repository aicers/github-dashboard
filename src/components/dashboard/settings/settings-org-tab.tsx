"use client";

import { useRouter } from "next/navigation";
import {
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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  REAUTH_ACTION_DEFINITIONS,
  type ReauthAction,
} from "@/lib/auth/reauth";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";
import type { GithubMemberSummary, GithubTeamSummary } from "@/lib/github/org";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
} from "@/lib/holidays/constants";
import type { CalendarHoliday, HolidayCalendar } from "@/lib/holidays/service";
import { cn } from "@/lib/utils";
import { SettingsOrgHolidayPanel } from "./settings-org-holiday-panel";

const ADMIN_ONLY_MESSAGE = "관리자 권한이 있는 사용자만 수정할 수 있습니다.";

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  result?: T;
  reauthRequired?: boolean;
};

export type SettingsOrgTabProps = {
  orgName: string;
  syncIntervalMinutes: number;
  organizationHolidayCalendarCodes: HolidayCalendarCode[];
  holidayPreviewCalendarCode: HolidayCalendarCode | null;
  holidayCalendars: HolidayCalendar[];
  initialPreviewHolidayEntries: CalendarHoliday[];
  repositories: RepositoryProfile[];
  excludedRepositoryIds: string[];
  members: UserProfile[];
  excludedMemberIds: string[];
  allowedTeamSlugs: string[];
  allowedUserIds: string[];
  organizationTeams: GithubTeamSummary[];
  organizationMembers: GithubMemberSummary[];
  isAdmin: boolean;
  authAccessTtlMinutes: number;
  authIdleTtlMinutes: number;
  authRefreshTtlDays: number;
  authMaxLifetimeDays: number;
  authReauthWindowHours: number;
  authReauthActions: string[];
  authReauthNewDevice: boolean;
  authReauthCountryChange: boolean;
  onReauthRequired: () => void;
};

export function SettingsOrgTab({
  orgName,
  syncIntervalMinutes,
  organizationHolidayCalendarCodes,
  holidayPreviewCalendarCode,
  holidayCalendars,
  initialPreviewHolidayEntries,
  repositories,
  excludedRepositoryIds,
  members,
  excludedMemberIds,
  allowedTeamSlugs,
  allowedUserIds,
  organizationTeams,
  organizationMembers,
  isAdmin,
  authAccessTtlMinutes,
  authIdleTtlMinutes,
  authRefreshTtlDays,
  authMaxLifetimeDays,
  authReauthWindowHours,
  authReauthActions,
  authReauthNewDevice,
  authReauthCountryChange,
  onReauthRequired,
}: SettingsOrgTabProps) {
  const router = useRouter();

  const initialAdminCalendarCode =
    organizationHolidayCalendarCodes[0] ??
    holidayPreviewCalendarCode ??
    DEFAULT_HOLIDAY_CALENDAR;

  const [name, setName] = useState(orgName);
  const [interval, setInterval] = useState(syncIntervalMinutes.toString());
  const [organizationHolidayCodes, setOrganizationHolidayCodes] = useState<
    HolidayCalendarCode[]
  >(organizationHolidayCalendarCodes);
  const [accessTtlMinutes, setAccessTtlMinutes] = useState(
    authAccessTtlMinutes.toString(),
  );
  const [idleTtlMinutes, setIdleTtlMinutes] = useState(
    authIdleTtlMinutes.toString(),
  );
  const [refreshTtlDays, setRefreshTtlDays] = useState(
    authRefreshTtlDays.toString(),
  );
  const [maxLifetimeDays, setMaxLifetimeDays] = useState(
    authMaxLifetimeDays.toString(),
  );
  const [reauthWindowHours, setReauthWindowHours] = useState(
    authReauthWindowHours.toString(),
  );
  const [reauthActions, setReauthActions] = useState<ReauthAction[]>(
    authReauthActions.filter((action): action is ReauthAction =>
      REAUTH_ACTION_DEFINITIONS.some((entry) => entry.id === action),
    ),
  );
  const [reauthNewDevice, setReauthNewDevice] = useState(authReauthNewDevice);
  const [reauthCountryChange, setReauthCountryChange] = useState(
    authReauthCountryChange,
  );
  const [orgFeedback, setOrgFeedback] = useState<string | null>(null);
  const [isSavingOrganization, startSavingOrganization] = useTransition();

  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  const normalizedAllowedTeams = useMemo(() => {
    const available = new Set(organizationTeams.map((team) => team.slug));
    return allowedTeamSlugs.filter((slug) => available.has(slug));
  }, [allowedTeamSlugs, organizationTeams]);
  const [allowedTeams, setAllowedTeams] = useState<string[]>(
    normalizedAllowedTeams,
  );
  const normalizedAllowedUsers = useMemo(() => {
    const available = new Set<string>();
    for (const member of organizationMembers) {
      if (member.nodeId) {
        available.add(member.nodeId);
      }
      available.add(member.login.toLowerCase());
    }

    return allowedUserIds.filter((value) => {
      if (!value) {
        return false;
      }

      if (available.has(value)) {
        return true;
      }

      return available.has(value.toLowerCase());
    });
  }, [allowedUserIds, organizationMembers]);
  const [allowedUsers, setAllowedUsers] = useState<string[]>(
    normalizedAllowedUsers,
  );
  const initialRepositoryMaintainers = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const repository of repositories) {
      map[repository.id] = Array.isArray(repository.maintainerIds)
        ? [...repository.maintainerIds]
        : [];
    }
    return map;
  }, [repositories]);
  const [repositoryMaintainers, setRepositoryMaintainers] = useState<
    Record<string, string[]>
  >(initialRepositoryMaintainers);

  const orgInputId = useId();
  const intervalInputId = useId();
  const accessTtlId = useId();
  const idleTtlId = useId();
  const refreshTtlId = useId();
  const maxLifetimeId = useId();
  const reauthWindowId = useId();
  const excludeSelectId = useId();
  const excludePeopleSelectId = useId();
  const allowedTeamsSelectId = useId();
  const allowedUsersSelectId = useId();
  const repositoryMaintainersSelectBaseId = useId();

  const canEditOrganization = isAdmin;

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

  const maintainedRepositoryCount = useMemo(() => {
    return repositories.reduce((count, repository) => {
      const assigned = repositoryMaintainers[repository.id] ?? [];
      return assigned.length > 0 ? count + 1 : count;
    }, 0);
  }, [repositories, repositoryMaintainers]);

  const sortedOrganizationTeams = useMemo(() => {
    return [...organizationTeams].sort((a, b) =>
      (a.name || a.slug).localeCompare(b.name || b.slug, undefined, {
        sensitivity: "base",
      }),
    );
  }, [organizationTeams]);

  const sortedOrganizationMembers = useMemo(() => {
    return [...organizationMembers].sort((a, b) =>
      a.login.localeCompare(b.login, undefined, {
        sensitivity: "base",
      }),
    );
  }, [organizationMembers]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setExcludedRepos(normalizedExcludedRepositories);
  }, [normalizedExcludedRepositories]);

  useEffect(() => {
    setExcludedPeople(normalizedExcludedMembers);
  }, [normalizedExcludedMembers]);

  useEffect(() => {
    setAllowedTeams(normalizedAllowedTeams);
  }, [normalizedAllowedTeams]);

  useEffect(() => {
    setAllowedUsers(normalizedAllowedUsers);
  }, [normalizedAllowedUsers]);

  useEffect(() => {
    setRepositoryMaintainers(initialRepositoryMaintainers);
  }, [initialRepositoryMaintainers]);

  useEffect(() => {
    setOrganizationHolidayCodes(organizationHolidayCalendarCodes);
  }, [organizationHolidayCalendarCodes]);

  useEffect(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    if (!orgFeedback) {
      return;
    }

    feedbackTimeoutRef.current = setTimeout(() => {
      setOrgFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 4000);
  }, [orgFeedback]);

  const handleRepositoryMaintainersChange = (
    repositoryId: string,
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const selected = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    const normalized = Array.from(
      new Set(selected.filter((value) => value.length > 0)),
    );
    setRepositoryMaintainers((previous) => ({
      ...previous,
      [repositoryId]: normalized,
    }));
  };

  const handleClearAllRepositoryMaintainers = () => {
    setRepositoryMaintainers((_previous) => {
      const cleared: Record<string, string[]> = {};
      for (const repository of repositories) {
        cleared[repository.id] = [];
      }
      return cleared;
    });
  };

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

  const handleAllowedTeamsChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const selected = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    setAllowedTeams(selected);
  };

  const handleClearAllowedTeams = () => {
    setAllowedTeams([]);
  };

  const handleAllowedUsersChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const selected = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    setAllowedUsers(selected);
  };

  const handleClearAllowedUsers = () => {
    setAllowedUsers([]);
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

  const handleToggleReauthAction = (action: ReauthAction) => {
    setReauthActions((current) =>
      current.includes(action)
        ? current.filter((entry) => entry !== action)
        : [...current, action],
    );
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
          throw new Error("동기화 간격은 1 이상의 정수여야 합니다.");
        }

        if (!name.trim()) {
          throw new Error("Organization 이름을 입력하세요.");
        }

        const repositoryMaintainersPayload = Object.fromEntries(
          repositories.map((repository) => [
            repository.id,
            (repositoryMaintainers[repository.id] ?? []).filter(
              (id) => typeof id === "string" && id.length > 0,
            ),
          ]),
        );

        const parsedAccessTtl = Number.parseInt(accessTtlMinutes, 10);
        const parsedIdleTtl = Number.parseInt(idleTtlMinutes, 10);
        const parsedRefreshTtl = Number.parseInt(refreshTtlDays, 10);
        const parsedMaxLifetime = Number.parseInt(maxLifetimeDays, 10);
        const parsedReauthWindow = Number.parseInt(reauthWindowHours, 10);

        if (
          Number.isNaN(parsedAccessTtl) ||
          parsedAccessTtl <= 0 ||
          Number.isNaN(parsedIdleTtl) ||
          parsedIdleTtl <= 0 ||
          Number.isNaN(parsedRefreshTtl) ||
          parsedRefreshTtl <= 0 ||
          Number.isNaN(parsedMaxLifetime) ||
          parsedMaxLifetime <= 0 ||
          Number.isNaN(parsedReauthWindow) ||
          parsedReauthWindow <= 0
        ) {
          throw new Error("세션 설정 값은 모두 양수여야 합니다.");
        }

        const response = await fetch("/api/sync/config", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orgName: name.trim(),
            syncIntervalMinutes: parsedInterval,
            excludedRepositories: excludedRepos,
            excludedPeople,
            allowedTeams,
            allowedUsers,
            organizationHolidayCalendarCodes: organizationHolidayCodes,
            repositoryMaintainers: repositoryMaintainersPayload,
            authAccessTtlMinutes: parsedAccessTtl,
            authIdleTtlMinutes: parsedIdleTtl,
            authRefreshTtlDays: parsedRefreshTtl,
            authMaxLifetimeDays: parsedMaxLifetime,
            authReauthWindowHours: parsedReauthWindow,
            authReauthActions: reauthActions,
            authReauthNewDevice: reauthNewDevice,
            authReauthCountryChange: reauthCountryChange,
          }),
        });
        const data = (await response.json()) as ApiResponse<unknown>;

        if (response.status === 428 || data.reauthRequired) {
          onReauthRequired();
          return;
        }

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
      {!canEditOrganization && (
        <p className="text-sm text-muted-foreground">{ADMIN_ONLY_MESSAGE}</p>
      )}
      {orgFeedback && <p className="text-sm text-primary">{orgFeedback}</p>}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Organization 이름</CardTitle>
          <CardDescription>
            동기화 대상 GitHub Organization 슬러그를 입력하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex flex-col gap-2 text-sm" htmlFor={orgInputId}>
            <span className="text-muted-foreground">Organization 이름</span>
            <Input
              id={orgInputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-organization"
              disabled={!canEditOrganization}
              title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
            />
          </label>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>자동 동기화 간격 (분)</CardTitle>
          <CardDescription>
            백엔드 데이터 수집 작업이 자동 실행되는 시간 간격을 설정합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label
            className="flex flex-col gap-2 text-sm"
            htmlFor={intervalInputId}
          >
            <span className="text-muted-foreground">자동 동기화 간격 (분)</span>
            <Input
              id={intervalInputId}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              type="number"
              min={1}
              disabled={!canEditOrganization}
              title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
            />
          </label>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Sign-in 세션 설정</CardTitle>
          <CardDescription>
            기본값은 access 60m, idle 30m, refresh 14d, max 30d, reauth 24h
            입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2" htmlFor={accessTtlId}>
              <span className="text-muted-foreground">Access TTL (분)</span>
              <Input
                id={accessTtlId}
                value={accessTtlMinutes}
                onChange={(event) => setAccessTtlMinutes(event.target.value)}
                type="number"
                min={1}
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              />
            </label>
            <label className="flex flex-col gap-2" htmlFor={idleTtlId}>
              <span className="text-muted-foreground">Idle TTL (분)</span>
              <Input
                id={idleTtlId}
                value={idleTtlMinutes}
                onChange={(event) => setIdleTtlMinutes(event.target.value)}
                type="number"
                min={1}
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              />
            </label>
            <label className="flex flex-col gap-2" htmlFor={refreshTtlId}>
              <span className="text-muted-foreground">Refresh TTL (일)</span>
              <Input
                id={refreshTtlId}
                value={refreshTtlDays}
                onChange={(event) => setRefreshTtlDays(event.target.value)}
                type="number"
                min={1}
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              />
            </label>
            <label className="flex flex-col gap-2" htmlFor={maxLifetimeId}>
              <span className="text-muted-foreground">Max lifetime (일)</span>
              <Input
                id={maxLifetimeId}
                value={maxLifetimeDays}
                onChange={(event) => setMaxLifetimeDays(event.target.value)}
                type="number"
                min={1}
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              />
            </label>
            <label className="flex flex-col gap-2" htmlFor={reauthWindowId}>
              <span className="text-muted-foreground">
                Reauth window (시간)
              </span>
              <Input
                id={reauthWindowId}
                value={reauthWindowHours}
                onChange={(event) => setReauthWindowHours(event.target.value)}
                type="number"
                min={1}
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">재인증 필요 액션</span>
            <div className="grid gap-2 md:grid-cols-2">
              {REAUTH_ACTION_DEFINITIONS.map((definition) => {
                const isChecked = reauthActions.includes(definition.id);
                return (
                  <label
                    key={definition.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border border-border/60 p-2",
                      !canEditOrganization && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleReauthAction(definition.id)}
                      disabled={!canEditOrganization}
                    />
                    <span>{definition.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">재인증 조건</span>
            <label
              className={cn(
                "flex items-center gap-2",
                !canEditOrganization && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={reauthNewDevice}
                onChange={(event) => setReauthNewDevice(event.target.checked)}
                disabled={!canEditOrganization}
              />
              <span>새 기기/브라우저 감지 시 재인증</span>
            </label>
            <label
              className={cn(
                "flex items-center gap-2",
                !canEditOrganization && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={reauthCountryChange}
                onChange={(event) =>
                  setReauthCountryChange(event.target.checked)
                }
                disabled={!canEditOrganization}
              />
              <span>국가 변경 감지 시 재인증</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>접근 허용 제어</CardTitle>
          <CardDescription>
            GitHub OAuth 로그인 허용 범위를 설정합니다. 선택된 팀이나 구성원만
            접근할 수 있으며, 비어 있으면 관리자만 로그인 가능합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-xs text-muted-foreground">
            목록은 Settings에 들어올 때 GitHub에서 갱신됩니다. 새로운 팀이나
            구성원이 보이지 않으면 페이지를 새로고침해 주세요.
          </p>
          {sortedOrganizationTeams.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              불러온 GitHub 팀이 없습니다. 조직의 팀이 없다면 그대로 두어도
              괜찮습니다.
            </p>
          ) : (
            <label
              className="flex flex-col gap-2"
              htmlFor={allowedTeamsSelectId}
            >
              <span className="text-muted-foreground">
                로그인 허용 팀을 선택하세요
              </span>
              <select
                id={allowedTeamsSelectId}
                multiple
                value={allowedTeams}
                onChange={handleAllowedTeamsChange}
                className="h-48 rounded-md border border-border/60 bg-background p-2 text-sm"
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              >
                {sortedOrganizationTeams.map((team) => (
                  <option key={team.slug} value={team.slug}>
                    {team.name} · {team.slug}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                여러 팀을 선택하려면 ⌘/Ctrl 키를 눌러 복수 선택하세요.
              </span>
            </label>
          )}
          {sortedOrganizationMembers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              불러온 GitHub 구성원이 없습니다. GITHUB_TOKEN과 Organization
              설정을 확인해 주세요.
            </p>
          ) : (
            <label
              className="flex flex-col gap-2"
              htmlFor={allowedUsersSelectId}
            >
              <span className="text-muted-foreground">
                로그인 허용 개별 구성원을 선택하세요
              </span>
              <select
                id={allowedUsersSelectId}
                multiple
                value={allowedUsers}
                onChange={handleAllowedUsersChange}
                className="h-48 rounded-md border border-border/60 bg-background p-2 text-sm"
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              >
                {sortedOrganizationMembers.map((member) => {
                  const value = member.nodeId ?? member.login;
                  return (
                    <option key={value} value={value}>
                      {member.login}
                    </option>
                  );
                })}
              </select>
              <span className="text-xs text-muted-foreground">
                여러 구성원을 선택하려면 ⌘/Ctrl 키를 눌러 복수 선택하세요.
              </span>
            </label>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            허용된 팀: {allowedTeams.length}개 · 허용된 구성원:{" "}
            {allowedUsers.length}명
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleClearAllowedTeams}
              disabled={!canEditOrganization || allowedTeams.length === 0}
              title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
            >
              허용 팀 비우기
            </Button>
            <Button
              variant="secondary"
              onClick={handleClearAllowedUsers}
              disabled={!canEditOrganization || allowedUsers.length === 0}
              title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
            >
              허용 구성원 비우기
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>저장소 책임자</CardTitle>
          <CardDescription>
            주의 필터에서 maintainer로 사용할 저장소별 책임자를 미리 지정하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {sortedRepositories.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              동기화된 저장소가 없습니다.
            </p>
          ) : sortedMembers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              지정할 구성원 정보가 없습니다. 먼저 사용자 동기화를 확인해 주세요.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                책임자로 지정된 구성원은 해당 저장소의 maintainer로 간주됩니다.
                지정하지 않으면 책임자가 없는 것으로 처리돼요.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {sortedRepositories.map((repository) => {
                  const selectId = `${repositoryMaintainersSelectBaseId}-${repository.id}`;
                  const selectedMaintainers =
                    repositoryMaintainers[repository.id] ?? [];
                  return (
                    <label
                      key={repository.id}
                      className="flex flex-col gap-2"
                      htmlFor={selectId}
                    >
                      <span className="font-medium text-foreground">
                        {repository.nameWithOwner ??
                          repository.name ??
                          repository.id}
                      </span>
                      <select
                        id={selectId}
                        multiple
                        value={selectedMaintainers}
                        onChange={(event) =>
                          handleRepositoryMaintainersChange(
                            repository.id,
                            event,
                          )
                        }
                        className="h-32 rounded-md border border-border/60 bg-background p-2 text-sm"
                        disabled={
                          !canEditOrganization || sortedMembers.length === 0
                        }
                        title={
                          !canEditOrganization
                            ? ADMIN_ONLY_MESSAGE
                            : sortedMembers.length === 0
                              ? "지정할 구성원 정보가 없습니다."
                              : undefined
                        }
                      >
                        {sortedMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.login ?? member.name ?? member.id}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-muted-foreground">
                        여러 책임자를 지정하려면 ⌘/Ctrl 키를 눌러 복수
                        선택하세요.
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            책임자 지정된 저장소: {maintainedRepositoryCount} /{" "}
            {sortedRepositories.length}
          </span>
          <Button
            variant="secondary"
            onClick={handleClearAllRepositoryMaintainers}
            disabled={!canEditOrganization || maintainedRepositoryCount === 0}
            title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
          >
            책임자 모두 비우기
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>저장소 제외</CardTitle>
          <CardDescription>
            제외된 저장소는 Analytics와 People 메뉴의 필터 목록에 표시되지
            않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {sortedRepositories.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              동기화된 저장소가 없습니다.
            </p>
          ) : (
            <label className="flex flex-col gap-2" htmlFor={excludeSelectId}>
              <span className="text-muted-foreground">
                제외할 저장소를 선택하세요
              </span>
              <select
                id={excludeSelectId}
                multiple
                value={excludedRepos}
                onChange={handleExcludedChange}
                className="h-48 rounded-md border border-border/60 bg-background p-2 text-sm"
                disabled={!canEditOrganization}
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
              >
                {sortedRepositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.nameWithOwner ?? repo.name ?? repo.id}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                여러 저장소를 선택하려면 ⌘/Ctrl 키를 눌러 복수 선택하세요.
              </span>
            </label>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <span className="text-xs text-muted-foreground">
            제외된 저장소: {excludedRepos.length}개
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
                title={!canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined}
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

      <SettingsOrgHolidayPanel
        organizationHolidayCodes={organizationHolidayCodes}
        onOrganizationHolidayCodesChange={setOrganizationHolidayCodes}
        holidayCalendars={holidayCalendars}
        initialPreviewHolidayEntries={initialPreviewHolidayEntries}
        holidayPreviewCalendarCode={holidayPreviewCalendarCode}
        initialAdminCalendarCode={initialAdminCalendarCode}
        isAdmin={isAdmin}
      />

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
  );
}
