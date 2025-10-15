import { SyncControls } from "@/components/dashboard/sync-controls";
import { readActiveSession } from "@/lib/auth/session";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const [session, status] = await Promise.all([
    readActiveSession(),
    fetchSyncStatus(),
  ]);

  return <SyncControls status={status} isAdmin={Boolean(session?.isAdmin)} />;
}
