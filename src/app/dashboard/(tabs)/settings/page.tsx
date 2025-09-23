import { SettingsView } from "@/components/dashboard/settings-view";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await fetchSyncStatus();
  const config = status.config;
  const timeZone = config?.timezone ?? "UTC";

  return (
    <SettingsView
      orgName={config?.org_name ?? ""}
      syncIntervalMinutes={config?.sync_interval_minutes ?? 60}
      timeZone={timeZone}
    />
  );
}
