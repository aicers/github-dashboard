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
};

export function DashboardTabs({ currentPathname }: DashboardTabsProps = {}) {
  const pathnameFromRouter = usePathname();
  const pathname = currentPathname ?? pathnameFromRouter;

  return (
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
              isActive ? "text-primary" : "text-slate-500 hover:text-slate-700",
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
  );
}
