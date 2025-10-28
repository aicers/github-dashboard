import { ActivityView } from "@/components/dashboard/activity-view";
import {
  buildActivityFilterOptionsFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
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

  const skipDatabase = process.env.PLAYWRIGHT_SKIP_DB === "1";

  const sessionPromise = readActiveSession();
  const filterOptionsPromise = skipDatabase
    ? Promise.resolve(buildActivityFilterOptionsFixture())
    : getActivityFilterOptions();

  const [filterOptions, session] = await Promise.all([
    filterOptionsPromise,
    sessionPromise,
  ]);
  const initialData = skipDatabase
    ? buildActivityListResultFixture()
    : await getActivityItems(params, {
        userId: session?.userId ?? null,
      });

  return (
    <ActivityView
      initialData={initialData}
      filterOptions={filterOptions}
      initialParams={params}
      currentUserId={session?.userId ?? null}
    />
  );
}
