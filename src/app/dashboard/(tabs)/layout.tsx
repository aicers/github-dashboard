import type { ReactNode } from "react";

import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";

export default function DashboardTabsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-10">
      <DashboardTabs />
      <div className="flex-1 pb-10">{children}</div>
    </div>
  );
}
