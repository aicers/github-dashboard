import { SettingsView } from "@/components/dashboard/settings-view";
import { readActiveSession } from "@/lib/auth/session";
import {
  getUserAvatarState,
  listAllRepositories,
  listAllUsers,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import type { GithubMemberSummary, GithubTeamSummary } from "@/lib/github/org";
import {
  fetchOrganizationMembers,
  fetchOrganizationTeams,
} from "@/lib/github/org";
import {
  type CalendarHoliday,
  getCalendarHolidays,
  listHolidayCalendars,
} from "@/lib/holidays/service";
import { fetchSyncConfig } from "@/lib/sync/service";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await readActiveSession();
  const config = await fetchSyncConfig();
  const timeSettings = await readUserTimeSettings(session?.userId ?? null);
  const holidayCalendars = await listHolidayCalendars();
  const selectedHolidayCode = timeSettings.holidayCalendarCode;
  let selectedHolidayEntries: CalendarHoliday[] = [];
  try {
    selectedHolidayEntries = await getCalendarHolidays(selectedHolidayCode);
  } catch (error) {
    console.error("[settings] Failed to load holidays", error);
    selectedHolidayEntries = [];
  }
  const repositories = await listAllRepositories();
  const members = await listAllUsers();
  const excludedRepositoryIds = Array.isArray(config?.excluded_repository_ids)
    ? (config?.excluded_repository_ids as string[])
    : [];
  const excludedMemberIds = Array.isArray(config?.excluded_user_ids)
    ? (config?.excluded_user_ids as string[])
    : [];
  const allowedTeamSlugs = Array.isArray(config?.allowed_team_slugs)
    ? (config?.allowed_team_slugs as string[])
    : [];
  const allowedUserIds = Array.isArray(config?.allowed_user_ids)
    ? (config?.allowed_user_ids as string[])
    : [];
  const currentUserProfile = session?.userId
    ? (members.find((member) => member.id === session.userId) ?? null)
    : null;
  const avatarState = session?.userId
    ? await getUserAvatarState(session.userId)
    : { avatarUrl: null, originalAvatarUrl: null, customAvatarUrl: null };
  const targetOrgSlug =
    env.GITHUB_ALLOWED_ORG ?? config?.org_name ?? env.GITHUB_ORG ?? "";
  let organizationTeams: GithubTeamSummary[] = [];
  let organizationMembers: GithubMemberSummary[] = [];

  if (targetOrgSlug) {
    try {
      organizationTeams = await fetchOrganizationTeams(targetOrgSlug);
    } catch (error) {
      console.error(
        "[settings] Failed to load GitHub teams for organization access controls",
        error,
      );
    }

    try {
      organizationMembers = await fetchOrganizationMembers(targetOrgSlug);
    } catch (error) {
      console.error(
        "[settings] Failed to load GitHub members for organization access controls",
        error,
      );
    }
  }

  return (
    <SettingsView
      orgName={config?.org_name ?? ""}
      syncIntervalMinutes={config?.sync_interval_minutes ?? 60}
      timeZone={timeSettings.timezone}
      weekStart={timeSettings.weekStart}
      dateTimeFormat={timeSettings.dateTimeFormat}
      holidayCalendarCode={timeSettings.holidayCalendarCode}
      holidayCalendars={holidayCalendars}
      initialHolidayEntries={selectedHolidayEntries}
      repositories={repositories}
      excludedRepositoryIds={excludedRepositoryIds}
      members={members}
      excludedMemberIds={excludedMemberIds}
      allowedTeamSlugs={allowedTeamSlugs}
      allowedUserIds={allowedUserIds}
      organizationTeams={organizationTeams}
      organizationMembers={organizationMembers}
      isAdmin={Boolean(session?.isAdmin)}
      currentUserId={session?.userId ?? null}
      currentUserName={currentUserProfile?.name ?? null}
      currentUserLogin={currentUserProfile?.login ?? null}
      currentUserAvatarUrl={avatarState.avatarUrl}
      currentUserOriginalAvatarUrl={avatarState.originalAvatarUrl}
      currentUserCustomAvatarUrl={avatarState.customAvatarUrl}
    />
  );
}
