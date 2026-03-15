"use client";

import { Building2, User } from "lucide-react";
import { useCallback, useState } from "react";
import { ReauthModal } from "@/components/dashboard/reauth-modal";
import { SettingsOrgTab } from "@/components/dashboard/settings/settings-org-tab";
import { SettingsPersonalTab } from "@/components/dashboard/settings/settings-personal-tab";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";
import type { GithubMemberSummary, GithubTeamSummary } from "@/lib/github/org";
import type { HolidayCalendarCode } from "@/lib/holidays/constants";
import type { CalendarHoliday, HolidayCalendar } from "@/lib/holidays/service";
import type { PersonalHoliday } from "@/lib/user/time-settings";
import { cn } from "@/lib/utils";

type SettingsViewProps = {
  orgName: string;
  syncIntervalMinutes: number;
  timeZone: string;
  weekStart: "sunday" | "monday";
  dateTimeFormat: string;
  personalHolidayCalendarCodes: HolidayCalendarCode[];
  organizationHolidayCalendarCodes: HolidayCalendarCode[];
  holidayPreviewCalendarCode: HolidayCalendarCode | null;
  holidayCalendars: HolidayCalendar[];
  initialPreviewHolidayEntries: CalendarHoliday[];
  personalHolidays: PersonalHoliday[];
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
  activityRowsPerPage: number;
  authAccessTtlMinutes: number;
  authIdleTtlMinutes: number;
  authRefreshTtlDays: number;
  authMaxLifetimeDays: number;
  authReauthWindowHours: number;
  authReauthActions: string[];
  authReauthNewDevice: boolean;
  authReauthCountryChange: boolean;
};

export function SettingsView({
  orgName,
  syncIntervalMinutes,
  timeZone,
  weekStart,
  dateTimeFormat,
  personalHolidayCalendarCodes,
  organizationHolidayCalendarCodes,
  holidayPreviewCalendarCode,
  holidayCalendars,
  initialPreviewHolidayEntries,
  personalHolidays: initialPersonalHolidays,
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
  activityRowsPerPage,
  authAccessTtlMinutes,
  authIdleTtlMinutes,
  authRefreshTtlDays,
  authMaxLifetimeDays,
  authReauthWindowHours,
  authReauthActions,
  authReauthNewDevice,
  authReauthCountryChange,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<"personal" | "organization">(
    "personal",
  );
  const [reauthOpen, setReauthOpen] = useState(false);

  const handleReauthConfirm = useCallback(() => {
    const returnPath = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/auth/reauth?next=${encodeURIComponent(returnPath)}`;
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <ReauthModal
        open={reauthOpen}
        onConfirm={handleReauthConfirm}
        onCancel={() => setReauthOpen(false)}
      />
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

        <div className={activeTab === "personal" ? undefined : "hidden"}>
          <SettingsPersonalTab
            timeZone={timeZone}
            weekStart={weekStart}
            dateTimeFormat={dateTimeFormat}
            personalHolidayCalendarCodes={personalHolidayCalendarCodes}
            organizationHolidayCalendarCodes={organizationHolidayCalendarCodes}
            holidayPreviewCalendarCode={holidayPreviewCalendarCode}
            holidayCalendars={holidayCalendars}
            initialPreviewHolidayEntries={initialPreviewHolidayEntries}
            initialPersonalHolidays={initialPersonalHolidays}
            activityRowsPerPage={activityRowsPerPage}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserLogin={currentUserLogin}
            currentUserAvatarUrl={currentUserAvatarUrl}
            currentUserOriginalAvatarUrl={currentUserOriginalAvatarUrl}
            currentUserCustomAvatarUrl={currentUserCustomAvatarUrl}
          />
        </div>

        <div className={activeTab === "organization" ? undefined : "hidden"}>
          <SettingsOrgTab
            orgName={orgName}
            syncIntervalMinutes={syncIntervalMinutes}
            organizationHolidayCalendarCodes={organizationHolidayCalendarCodes}
            holidayPreviewCalendarCode={holidayPreviewCalendarCode}
            holidayCalendars={holidayCalendars}
            initialPreviewHolidayEntries={initialPreviewHolidayEntries}
            repositories={repositories}
            excludedRepositoryIds={excludedRepositoryIds}
            members={members}
            excludedMemberIds={excludedMemberIds}
            allowedTeamSlugs={allowedTeamSlugs}
            allowedUserIds={allowedUserIds}
            organizationTeams={organizationTeams}
            organizationMembers={organizationMembers}
            isAdmin={isAdmin}
            authAccessTtlMinutes={authAccessTtlMinutes}
            authIdleTtlMinutes={authIdleTtlMinutes}
            authRefreshTtlDays={authRefreshTtlDays}
            authMaxLifetimeDays={authMaxLifetimeDays}
            authReauthWindowHours={authReauthWindowHours}
            authReauthActions={authReauthActions}
            authReauthNewDevice={authReauthNewDevice}
            authReauthCountryChange={authReauthCountryChange}
            onReauthRequired={() => setReauthOpen(true)}
          />
        </div>
      </div>
    </section>
  );
}
