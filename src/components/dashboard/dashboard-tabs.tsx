"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/people", label: "People" },
  { href: "/dashboard/attention", label: "Follow-ups" },
  { href: "/dashboard/sync", label: "Sync" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function DashboardTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 text-sm font-medium">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href as Route}
            className={cn(
              "rounded-md px-3 py-2 transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
