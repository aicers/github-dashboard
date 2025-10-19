import { AnalyticsView } from "@/components/dashboard/analytics-view";
import { buildDashboardAnalyticsFixture } from "@/components/test-harness/dashboard-fixtures";
import { buildSyncStatusFixture } from "@/components/test-harness/sync-fixtures";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncConfig } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const skipDatabase = process.env.PLAYWRIGHT_SKIP_DB === "1";

  const syncConfig = await (async () => {
    if (skipDatabase) {
      return buildSyncStatusFixture().config;
    }

    try {
      return await fetchSyncConfig();
    } catch (error) {
      console.error(
        "[github-dashboard] Falling back to fixture sync config",
        error,
      );
      return buildSyncStatusFixture().config;
    }
  })();

  const { start, end } = resolveDashboardRange(syncConfig);

  const analytics = await (async () => {
    if (skipDatabase) {
      return buildDashboardAnalyticsFixture();
    }

    try {
      return await getDashboardAnalytics({ start, end });
    } catch (error) {
      console.error(
        "[github-dashboard] Falling back to fixture analytics",
        error,
      );
      return buildDashboardAnalyticsFixture();
    }
  })();

  return (
    <AnalyticsView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      orgName={syncConfig?.org_name}
    />
  );
}
