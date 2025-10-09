import { AnalyticsView } from "@/components/dashboard/analytics-view";
import { buildDashboardAnalyticsFixture } from "@/components/test-harness/dashboard-fixtures";
import { buildSyncStatusFixture } from "@/components/test-harness/sync-fixtures";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const skipDatabase = process.env.PLAYWRIGHT_SKIP_DB === "1";

  const status = await (async () => {
    if (skipDatabase) {
      return buildSyncStatusFixture();
    }

    try {
      return await fetchSyncStatus();
    } catch (error) {
      console.error(
        "[github-dashboard] Falling back to fixture sync status",
        error,
      );
      return buildSyncStatusFixture();
    }
  })();

  const { start, end } = resolveDashboardRange(status.config);

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
      orgName={status.config?.org_name}
    />
  );
}
