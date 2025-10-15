import { PeopleView } from "@/components/dashboard/people-view";
import { readActiveSession } from "@/lib/auth/session";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const [status, session] = await Promise.all([
    fetchSyncStatus(),
    readActiveSession(),
  ]);
  const { start, end } = resolveDashboardRange(status.config);
  const analytics = await getDashboardAnalytics({ start, end });

  return (
    <PeopleView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      currentUserId={session?.userId ?? null}
    />
  );
}
