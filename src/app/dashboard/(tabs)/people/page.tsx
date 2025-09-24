import { buildRangeFromPreset } from "@/components/dashboard/dashboard-filters";
import { PeopleView } from "@/components/dashboard/people-view";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { fetchSyncStatus } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const status = await fetchSyncStatus();
  const timeZone = status.config?.timezone ?? "UTC";
  const weekStart =
    (status.config?.week_start as "sunday" | "monday") ?? "monday";
  const presetRange = buildRangeFromPreset("last_30_days", timeZone, weekStart);
  const start = presetRange?.start ?? new Date().toISOString();
  const end = presetRange?.end ?? new Date().toISOString();
  const analytics = await getDashboardAnalytics({ start, end });

  return (
    <PeopleView initialAnalytics={analytics} defaultRange={{ start, end }} />
  );
}
