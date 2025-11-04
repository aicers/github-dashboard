import { Suspense } from "react";
import { ActivityView } from "@/components/dashboard/activity-view";
import {
  buildActivityFilterOptionsFixture,
  buildActivityListParamsFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
import { SAVED_FILTER_LIMIT } from "@/lib/activity/filter-store";

export default function ActivityHarnessPage() {
  const initialData = buildActivityListResultFixture();
  const filterOptions = buildActivityFilterOptionsFixture();
  const initialParams = buildActivityListParamsFixture();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={null}>
        <ActivityView
          initialData={initialData}
          filterOptions={filterOptions}
          initialParams={initialParams}
          currentUserId="user-self"
          currentUserIsAdmin
          savedFiltersLimit={SAVED_FILTER_LIMIT}
        />
      </Suspense>
    </main>
  );
}
