import { AnalyticsView } from "@/components/dashboard/analytics-view";
import { readActiveSession } from "@/lib/auth/session";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncConfig } from "@/lib/sync/service";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await readActiveSession();
  const syncConfig = await fetchSyncConfig();
  const userTimeSettings = await readUserTimeSettings(session?.userId ?? null);

  const { start, end } = resolveDashboardRange(syncConfig, {
    userTimeSettings,
  });

  const analytics = await getDashboardAnalytics(
    { start, end },
    { userId: session?.userId ?? null },
  );

  return (
    <AnalyticsView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      orgName={syncConfig?.org_name}
    />
  );
}
