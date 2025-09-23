import { SyncControls } from "@/components/dashboard/sync-controls";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const status = await fetchSyncStatus();
  return <SyncControls status={status} />;
}
