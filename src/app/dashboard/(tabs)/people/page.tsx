import { PeopleView } from "@/components/dashboard/people-view";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const status = await fetchSyncStatus();
  const { start, end } = resolveDashboardRange(status.config);
  const analytics = await getDashboardAnalytics({ start, end });

  return (
    <PeopleView initialAnalytics={analytics} defaultRange={{ start, end }} />
  );
}
