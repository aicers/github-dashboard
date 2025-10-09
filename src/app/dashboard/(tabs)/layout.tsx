import { redirect } from "next/navigation";
import type { ReactNode } from "react";
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
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-10">
      <DashboardTabs />
      <div className="flex-1 pb-10">{children}</div>
    </div>
  );
}
