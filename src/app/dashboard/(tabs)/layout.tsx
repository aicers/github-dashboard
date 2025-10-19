import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { SyncStatusPanel } from "@/components/dashboard/sync-status-panel";
import { readActiveSession } from "@/lib/auth/session";
import { getUserProfiles } from "@/lib/db/operations";

export default async function DashboardTabsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await readActiveSession();

  if (!session) {
    redirect("/auth/github?next=/dashboard/activity");
  }

  const profile = session
    ? ((await getUserProfiles([session.userId])).find(
        (user) => user.id === session.userId,
      ) ?? null)
    : null;

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
            <DashboardTabs />
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
