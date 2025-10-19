import { PeopleView } from "@/components/dashboard/people-view";
import { readActiveSession } from "@/lib/auth/session";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncConfig } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const [config, session] = await Promise.all([
    fetchSyncConfig(),
    readActiveSession(),
  ]);
  const { start, end } = resolveDashboardRange(config);
  const analytics = await getDashboardAnalytics({ start, end });

  return (
    <PeopleView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      currentUserId={session?.userId ?? null}
    />
  );
}
