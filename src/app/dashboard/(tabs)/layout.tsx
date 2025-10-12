import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { readActiveSession } from "@/lib/auth/session";

export default async function DashboardTabsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await readActiveSession();

  if (!session) {
    redirect("/auth/github?next=/dashboard/activity");
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100/80">
      <div className="bg-white">
        <div className="mx-auto w-full max-w-[1232px] px-3 pt-4">
          <DashboardHeader userId={session.userId} />
          <div className="mt-2">
            <DashboardTabs />
          </div>
        </div>
      </div>
      <div className="flex-1">
        <div className="mx-auto w-full max-w-[1232px] px-3 pt-8 pb-10">
          {children}
        </div>
      </div>
    </div>
  );
}
