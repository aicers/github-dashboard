import { SyncControls } from "@/components/dashboard/sync-controls";
import { readActiveSession } from "@/lib/auth/session";
import { fetchSyncStatus } from "@/lib/sync/service";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export const dynamic = "force-dynamic";

export default async function SyncBackupPage() {
  const [session, status] = await Promise.all([
    readActiveSession(),
    fetchSyncStatus(),
  ]);
  const userTimeSettings = await readUserTimeSettings(session?.userId ?? null);

  return (
    <SyncControls
      status={status}
      isAdmin={Boolean(session?.isAdmin)}
      timeZone={userTimeSettings.timezone}
      dateTimeFormat={userTimeSettings.dateTimeFormat}
      view="backup"
      currentPathname="/dashboard/sync/backup"
    />
  );
}
