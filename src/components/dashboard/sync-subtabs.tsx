"use client";

import type { LucideIcon } from "lucide-react";
import { Database, History, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs: Array<{
  key: "sync" | "logs" | "backup";
  label: string;
  icon: LucideIcon;
  href: Route;
}> = [
  {
    key: "sync",
    label: "동기화",
    icon: RefreshCw,
    href: "/dashboard/sync",
  },
  {
    key: "logs",
    label: "동기화 로그",
    icon: History,
    href: "/dashboard/sync/logs",
  },
  {
    key: "backup",
    label: "백업",
    icon: Database,
    href: "/dashboard/sync/backup",
  },
];

type SyncSubTabsProps = {
  currentPathname?: string;
};

export function SyncSubTabs({ currentPathname }: SyncSubTabsProps = {}) {
  const pathnameFromRouter = usePathname();
  const pathname = currentPathname ?? pathnameFromRouter;

  return (
    <nav className="border-b border-border/80" aria-label="Sync 하위 메뉴">
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
