import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { SyncStatusPanel } from "@/components/dashboard/sync-status-panel";
import { readActiveSession } from "@/lib/auth/session";
import { getUserProfiles } from "@/lib/db/operations";
import { fetchSyncConfig } from "@/lib/sync/service";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export default async function DashboardTabsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await readActiveSession();

  if (!session) {
    redirect("/auth/github?next=/dashboard/activity");
  }

  const [profiles, syncConfig, timeSettings] = await Promise.all([
    getUserProfiles([session.userId]),
    fetchSyncConfig(),
    readUserTimeSettings(session.userId),
  ]);
  const profile = profiles.find((user) => user.id === session.userId) ?? null;
  const rawLastSync = syncConfig?.last_sync_completed_at ?? null;
  let lastSyncCompletedAt: string | null = null;
  if (rawLastSync instanceof Date) {
    lastSyncCompletedAt = Number.isNaN(rawLastSync.valueOf())
      ? null
      : rawLastSync.toISOString();
  } else if (typeof rawLastSync === "string" && rawLastSync.trim().length) {
    const parsed = new Date(rawLastSync);
    lastSyncCompletedAt = Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString();
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100/80">
      <div className="bg-white">
        <div className="mx-auto w-full max-w-[1232px] px-3 pt-4">
          <DashboardHeader
            userId={session.userId}
            userName={profile?.name ?? null}
            userLogin={profile?.login ?? null}
            userAvatarUrl={profile?.avatarUrl ?? null}
          />
          <div className="mt-0.5">
            <DashboardTabs
              initialLastSyncCompletedAt={lastSyncCompletedAt}
              dateTimeFormat={timeSettings.dateTimeFormat}
              timeZone={timeSettings.timezone}
            />
          </div>
        </div>
      </div>
      <div className="flex-1">
        <div className="mx-auto w-full max-w-[1232px] px-3 pt-8 pb-10">
          <SyncStatusPanel />
          {children}
        </div>
      </div>
    </div>
  );
}
