import { SyncControlsHarness } from "@/components/test-harness/sync-controls-harness";
import type { SyncStatus } from "@/lib/sync/service";

const status: SyncStatus = {
  config: {
    id: "default",
    org_name: "acme",
    auto_sync_enabled: true,
    sync_interval_minutes: 60,
    timezone: "Asia/Seoul",
    week_start: "monday",
    excluded_repository_ids: [],
    excluded_user_ids: [],
    last_sync_started_at: "2024-04-02T09:00:00.000Z",
    last_sync_completed_at: "2024-04-02T10:30:00.000Z",
    last_successful_sync_at: "2024-04-02T10:30:00.000Z",
  },
  logs: [
    {
      id: 1,
      resource: "issues",
      status: "success",
      message: "Processed issues",
      started_at: "2024-04-02T09:00:00.000Z",
      finished_at: "2024-04-02T09:30:00.000Z",
    },
    {
      id: 2,
      resource: "pull_requests",
      status: "failed",
      message: "Timeout",
      started_at: "2024-04-02T09:00:00.000Z",
      finished_at: "2024-04-02T09:15:00.000Z",
    },
  ],
  dataFreshness: {
    issues: "2024-04-02T10:30:00.000Z",
    pullRequests: "2024-04-02T10:30:00.000Z",
    reviews: "2024-04-02T10:30:00.000Z",
    comments: "2024-04-02T10:30:00.000Z",
  },
};

export default function SyncHarnessPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <SyncControlsHarness status={status} />
    </main>
  );
}
