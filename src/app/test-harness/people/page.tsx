import { PeopleView } from "@/components/dashboard/people-view";
import {
  buildDashboardAnalyticsFixture,
  DASHBOARD_FIXTURE_RANGE,
} from "@/components/test-harness/dashboard-fixtures";

export default function PeopleHarnessPage() {
  const analytics = buildDashboardAnalyticsFixture();
  const initialAnalytics = {
    ...analytics,
    individual: null,
  };
  const currentUserId = initialAnalytics.contributors[0]?.id ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <PeopleView
        initialAnalytics={initialAnalytics}
        defaultRange={DASHBOARD_FIXTURE_RANGE}
        currentUserId={currentUserId}
      />
    </main>
  );
}
