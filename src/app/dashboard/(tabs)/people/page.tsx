import { PeopleView } from "@/components/dashboard/people-view";
import { readActiveSession } from "@/lib/auth/session";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { resolveDashboardRange } from "@/lib/dashboard/date-range";
import { fetchSyncConfig } from "@/lib/sync/service";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const [config, session] = await Promise.all([
    fetchSyncConfig(),
    readActiveSession(),
  ]);
  const userTimeSettings = await readUserTimeSettings(session?.userId ?? null);
  const { start, end } = resolveDashboardRange(config, {
    userTimeSettings,
  });
  const analytics = await getDashboardAnalytics(
    { start, end },
    { userId: session?.userId ?? null },
  );

  return (
    <PeopleView
      initialAnalytics={analytics}
      defaultRange={{ start, end }}
      currentUserId={session?.userId ?? null}
    />
  );
}
