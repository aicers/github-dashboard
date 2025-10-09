import { ActivityView } from "@/components/dashboard/activity-view";
import {
  createSearchParamsFromRecord,
  parseActivityListParams,
} from "@/lib/activity/params";
import {
  getActivityFilterOptions,
  getActivityItems,
} from "@/lib/activity/service";

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

  const [initialData, filterOptions] = await Promise.all([
    getActivityItems(params),
    getActivityFilterOptions(),
  ]);

  return (
    <ActivityView
      initialData={initialData}
      filterOptions={filterOptions}
      initialParams={params}
    />
  );
}
