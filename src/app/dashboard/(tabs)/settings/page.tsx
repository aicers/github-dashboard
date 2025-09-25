import { SettingsView } from "@/components/dashboard/settings-view";
import { listAllRepositories, listAllUsers } from "@/lib/db/operations";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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

  return (
    <SettingsView
      orgName={config?.org_name ?? ""}
      syncIntervalMinutes={config?.sync_interval_minutes ?? 60}
      timeZone={timeZone}
      weekStart={(config?.week_start as "sunday" | "monday") ?? "monday"}
      repositories={repositories}
      excludedRepositoryIds={excludedRepositoryIds}
      members={members}
      excludedMemberIds={excludedMemberIds}
    />
  );
}
