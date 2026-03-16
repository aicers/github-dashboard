import { ActivityView } from "@/components/dashboard/activity-view";
import { SAVED_FILTER_LIMIT } from "@/lib/activity/filter-store";
import {
  createSearchParamsFromRecord,
  parseActivityListParams,
} from "@/lib/activity/params";
import {
  getActivityFilterOptions,
  getActivityItems,
} from "@/lib/activity/service";
import { readActiveSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type ActivityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActivityPage({
  searchParams,
}: ActivityPageProps) {
  const resolvedSearchParams = await searchParams;
  const params = parseActivityListParams(
    createSearchParamsFromRecord(resolvedSearchParams),
  );

  const [filterOptions, session] = await Promise.all([
    getActivityFilterOptions(),
    readActiveSession(),
  ]);

  const initialData = await getActivityItems(params, {
    userId: session?.userId ?? null,
  });

  return (
    <ActivityView
      initialData={initialData}
      filterOptions={filterOptions}
      initialParams={params}
      currentUserId={session?.userId ?? null}
      currentUserIsAdmin={session?.isAdmin ?? false}
      savedFiltersLimit={SAVED_FILTER_LIMIT}
    />
  );
}
