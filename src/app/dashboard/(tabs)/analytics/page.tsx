import { AnalyticsView } from "@/components/dashboard/analytics-view";
import { buildDashboardAnalyticsFixture } from "@/components/test-harness/dashboard-fixtures";
import { buildSyncStatusFixture } from "@/components/test-harness/sync-fixtures";
import { readActiveSession } from "@/lib/auth/session";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncConfig } from "@/lib/sync/service";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const skipDatabase = process.env.PLAYWRIGHT_SKIP_DB === "1";
  const session = await readActiveSession();

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

  const fallbackTimeSettings = {
    timezone: "UTC",
    weekStart: "monday" as const,
    dateTimeFormat: "auto",
  };
  const userTimeSettings = await (async () => {
    if (skipDatabase) {
      return fallbackTimeSettings;
    }
    try {
      return await readUserTimeSettings(session?.userId ?? null);
    } catch (error) {
      console.error(
        "[github-dashboard] Falling back to default time settings",
        error,
      );
      return fallbackTimeSettings;
    }
  })();

  const { start, end } = resolveDashboardRange(syncConfig, {
    userTimeSettings,
  });

  const analytics = await (async () => {
    if (skipDatabase) {
      return buildDashboardAnalyticsFixture();
    }

    try {
      return await getDashboardAnalytics(
        { start, end },
        { userId: session?.userId ?? null },
      );
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
