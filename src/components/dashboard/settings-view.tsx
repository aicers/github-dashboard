"use client";

import { Building2, Camera, ImageOff, Loader2, User } from "lucide-react";
import Image from "next/image";
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
  DATE_TIME_FORMAT_OPTIONS,
  type DateTimeDisplayFormat,
  normalizeDateTimeDisplayFormat,
} from "@/lib/date-time-format";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";
import type { GithubMemberSummary, GithubTeamSummary } from "@/lib/github/org";
import { buildUserInitials } from "@/lib/user/initials";
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

const MAX_AVATAR_FILE_SIZE = 4 * 1024 * 1024; // 4MB
const ACCEPTED_AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

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
  allowedTeamSlugs: string[];
  allowedUserIds: string[];
  organizationTeams: GithubTeamSummary[];
  organizationMembers: GithubMemberSummary[];
  isAdmin: boolean;
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserLogin: string | null;
  currentUserAvatarUrl: string | null;
  currentUserOriginalAvatarUrl: string | null;
  currentUserCustomAvatarUrl: string | null;
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
  allowedTeamSlugs,
  allowedUserIds,
  organizationTeams,
  organizationMembers,
  isAdmin,
  currentUserId,
  currentUserName,
  currentUserLogin,
  currentUserAvatarUrl,
  currentUserOriginalAvatarUrl,
  currentUserCustomAvatarUrl,
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
  const avatarInitials = useMemo(
    () =>
      buildUserInitials({
        name: currentUserName,
        login: currentUserLogin,
        fallback: currentUserId,
      }),
    [currentUserId, currentUserLogin, currentUserName],
  );
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
  const [isSavingPersonal, startSavingPersonal] = useTransition();
  const [isSavingOrganization, startSavingOrganization] = useTransition();
  const [isUploadingAvatar, startUploadingAvatar] = useTransition();
  const [isRemovingAvatar, startRemovingAvatar] = useTransition();
  const [activeTab, setActiveTab] = useState<"personal" | "organization">(
    "personal",
  );
  const avatarInputId = useId();
  const orgInputId = useId();
  const intervalInputId = useId();
  const excludeSelectId = useId();
  const excludePeopleSelectId = useId();
  const allowedTeamsSelectId = useId();
  const allowedUsersSelectId = useId();
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const canEditOrganization = isAdmin;

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
    setDateTimeFormatValue(normalizeDateTimeDisplayFormat(dateTimeFormat));
  }, [dateTimeFormat]);

  useEffect(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    const message = activeTab === "personal" ? personalFeedback : orgFeedback;
    if (!message) {
      return;
    }

    feedbackTimeoutRef.current = setTimeout(() => {
      if (activeTab === "personal") {
        setPersonalFeedback(null);
      } else {
        setOrgFeedback(null);
      }
      feedbackTimeoutRef.current = null;
    }, 4000);
  }, [personalFeedback, orgFeedback, activeTab]);

  useEffect(() => {
    if (activeTab === "personal") {
      setOrgFeedback(null);
    } else if (activeTab === "organization") {
      setPersonalFeedback(null);
    }
  }, [activeTab]);

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

  const hasPersistedAvatar = Boolean(persistedAvatarUrl);
  const hasCustomAvatar = Boolean(persistedCustomAvatarUrl);
  const hasSelectedAvatar = Boolean(avatarFile);
  const isAvatarMutating = isUploadingAvatar || isRemovingAvatar;

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
            allowedTeams,
            allowedUsers,
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
                          alt={
                            currentUserName ??
                            currentUserLogin ??
                            avatarInitials
                          }
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
                      <p className="text-xs text-emerald-600">
                        {avatarFeedback}
                      </p>
                    ) : null}
                  </div>
                </div>
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
                <CardTitle>접근 허용 제어</CardTitle>
                <CardDescription>
                  GitHub OAuth 로그인 허용 범위를 설정합니다. 선택된 팀이나
                  구성원만 접근할 수 있으며, 비어 있으면 관리자만 로그인
                  가능합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <p className="text-xs text-muted-foreground">
                  목록은 Settings에 들어올 때 GitHub에서 갱신됩니다. 새로운
                  팀이나 구성원이 보이지 않으면 페이지를 새로고침해 주세요.
                </p>
                {sortedOrganizationTeams.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    불러온 GitHub 팀이 없습니다. 조직의 팀이 없다면 그대로
                    두어도 괜찮습니다.
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
                      title={
                        !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                      }
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
                      title={
                        !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                      }
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
                    title={
                      !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                    }
                  >
                    허용 팀 비우기
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleClearAllowedUsers}
                    disabled={!canEditOrganization || allowedUsers.length === 0}
                    title={
                      !canEditOrganization ? ADMIN_ONLY_MESSAGE : undefined
                    }
                  >
                    허용 구성원 비우기
                  </Button>
                </div>
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
                  <label
                    className="flex flex-col gap-2"
                    htmlFor={excludeSelectId}
                  >
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
