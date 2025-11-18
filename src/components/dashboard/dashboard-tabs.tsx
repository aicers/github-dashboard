"use client";

import {
  Activity,
  BarChart3,
  ClipboardList,
  RefreshCw,
  Settings,
  Users,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { TimestampBadge } from "@/components/dashboard/timestamp-badge";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { subscribeToSyncStream } from "@/lib/sync/client-stream";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/people", label: "People", icon: Users },
  { href: "/dashboard/attention", label: "Follow-ups", icon: ClipboardList },
  { href: "/dashboard/sync", label: "Sync", icon: RefreshCw },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

type DashboardTabsProps = {
  currentPathname?: string;
  initialLastSyncCompletedAt?: string | null;
  dateTimeFormat?: DateTimeDisplayFormat | null;
  timeZone?: string | null;
};

export function DashboardTabs({
  currentPathname,
  initialLastSyncCompletedAt = null,
  dateTimeFormat,
  timeZone,
}: DashboardTabsProps = {}) {
  const pathnameFromRouter = usePathname();
  const pathname = currentPathname ?? pathnameFromRouter;
  const [latestSyncCompletedAt, setLatestSyncCompletedAt] = useState<
    string | null
  >(initialLastSyncCompletedAt);

  useEffect(() => {
    setLatestSyncCompletedAt(initialLastSyncCompletedAt ?? null);
  }, [initialLastSyncCompletedAt]);

  useEffect(() => {
    const unsubscribe = subscribeToSyncStream((event) => {
      if (event.type === "run-completed" && event.status === "success") {
        setLatestSyncCompletedAt(event.completedAt);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-0">
      <nav className="flex flex-wrap items-center gap-2 pb-0">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href as Route}
              className={cn(
                "group relative flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition",
                isActive
                  ? "text-primary"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition",
                  isActive
                    ? "text-primary"
                    : "text-slate-400 group-hover:text-slate-600",
                )}
                strokeWidth={1.8}
                aria-hidden
              />
              <span>{tab.label}</span>
              <span
                className={cn(
                  "absolute inset-x-4 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-[#ad46ff] via-[#b05bff] to-[#7047ff] transition-opacity",
                  isActive ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col items-end text-xs text-muted-foreground">
        <TimestampBadge
          label="Latest GitHub Sync:"
          timestamp={latestSyncCompletedAt}
          timezone={timeZone ?? undefined}
          dateTimeFormat={dateTimeFormat}
        />
      </div>
    </div>
  );
}
