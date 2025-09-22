import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { fetchDashboardStats, fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [status, stats] = await Promise.all([
    fetchSyncStatus(),
    fetchDashboardStats(),
  ]);

  return <DashboardClient status={status} stats={stats} />;
}
