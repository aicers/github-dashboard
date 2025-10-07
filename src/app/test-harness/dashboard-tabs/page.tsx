import { DashboardTabsHarness } from "@/components/test-harness/dashboard-tabs-harness";

export default function DashboardTabsHarnessPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <DashboardTabsHarness />
    </main>
  );
}
