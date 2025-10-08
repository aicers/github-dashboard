import { AnalyticsView } from "@/components/dashboard/analytics-view";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const status = await fetchSyncStatus();
  const { start, end } = resolveDashboardRange(status.config);

  const analytics = await getDashboardAnalytics({ start, end });

  return (
    <AnalyticsView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      orgName={status.config?.org_name}
    />
  );
}
