import { AnalyticsView } from "@/components/dashboard/analytics-view";
import {
  buildDashboardAnalyticsFixture,
  DASHBOARD_FIXTURE_RANGE,
} from "@/components/test-harness/dashboard-fixtures";

export default function AnalyticsHarnessPage() {
  const analytics = buildDashboardAnalyticsFixture();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <AnalyticsView
        orgName="acme"
        initialAnalytics={analytics}
        defaultRange={DASHBOARD_FIXTURE_RANGE}
      />
    </main>
  );
}
