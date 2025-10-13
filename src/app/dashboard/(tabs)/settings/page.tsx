import { SettingsView } from "@/components/dashboard/settings-view";
import { readActiveSession } from "@/lib/auth/session";
import {
  getUserAvatarState,
  listAllRepositories,
  listAllUsers,
} from "@/lib/db/operations";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await readActiveSession();
  const status = await fetchSyncStatus();
  const config = status.config;
  const timeZone = config?.timezone ?? "UTC";
  const repositories = await listAllRepositories();
  const members = await listAllUsers();
  const excludedRepositoryIds = Array.isArray(config?.excluded_repository_ids)
    ? (config?.excluded_repository_ids as string[])
    : [];
  const excludedMemberIds = Array.isArray(config?.excluded_user_ids)
    ? (config?.excluded_user_ids as string[])
    : [];
  const currentUserProfile = session?.userId
    ? (members.find((member) => member.id === session.userId) ?? null)
    : null;
  const avatarState = session?.userId
    ? await getUserAvatarState(session.userId)
    : { avatarUrl: null, originalAvatarUrl: null, customAvatarUrl: null };

  return (
    <SettingsView
      orgName={config?.org_name ?? ""}
      syncIntervalMinutes={config?.sync_interval_minutes ?? 60}
      timeZone={timeZone}
      weekStart={(config?.week_start as "sunday" | "monday") ?? "monday"}
      dateTimeFormat={config?.date_time_format ?? "auto"}
      repositories={repositories}
      excludedRepositoryIds={excludedRepositoryIds}
      members={members}
      excludedMemberIds={excludedMemberIds}
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
