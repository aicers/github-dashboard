import { AnalyticsView } from "@/components/dashboard/analytics-view";
import { buildRangeFromPreset } from "@/components/dashboard/dashboard-filters";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const status = await fetchSyncStatus();
  const timeZone = status.config?.timezone ?? "UTC";
  const weekStart =
    (status.config?.week_start as "sunday" | "monday") ?? "monday";
  const presetRange = buildRangeFromPreset("last_30_days", timeZone, weekStart);
  const start = presetRange?.start ?? new Date().toISOString();
  const end = presetRange?.end ?? new Date().toISOString();

  const analytics = await getDashboardAnalytics({ start, end });

  return (
    <AnalyticsView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      orgName={status.config?.org_name}
    />
  );
}
