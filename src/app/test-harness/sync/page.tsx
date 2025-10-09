import { SyncControlsHarness } from "@/components/test-harness/sync-controls-harness";
import { buildSyncStatusFixture } from "@/components/test-harness/sync-fixtures";

export default function SyncHarnessPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <SyncControlsHarness status={buildSyncStatusFixture()} />
    </main>
  );
}
