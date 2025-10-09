"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useCallback, useMemo, useState } from "react";

import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";

type DashboardTabsHarnessProps = {
  initialPathname?: string;
};

export function DashboardTabsHarness({
  initialPathname = "/dashboard/activity",
}: DashboardTabsHarnessProps) {
  const [pathname, setPathname] = useState(initialPathname);

  const resolveHref = useCallback(
    (href: Parameters<AppRouterInstance["push"]>[0]) => {
      if (typeof href === "string") {
        return href;
      }
      const candidate = href as unknown;
      if (candidate instanceof URL) {
        return candidate.pathname || candidate.href;
      }
      if (typeof candidate === "object" && candidate !== null) {
        const { pathname } = candidate as { pathname?: unknown };
        if (typeof pathname === "string") {
          return pathname;
        }
        const { href: hrefString } = candidate as { href?: unknown };
        if (typeof hrefString === "string") {
          return hrefString;
        }
      }
      return initialPathname;
    },
    [initialPathname],
  );

  const router = useMemo<AppRouterInstance>(
    () => ({
      back: () => {},
      forward: () => {},
      prefetch: async () => {},
      push: async (href) => {
        setPathname(resolveHref(href));
      },
      replace: async (href) => {
        setPathname(resolveHref(href));
      },
      refresh: () => {},
    }),
    [resolveHref],
  );

  return (
    <AppRouterContext.Provider value={router}>
      <div className="flex flex-col gap-4">
        <p data-testid="current-path" className="text-sm text-muted-foreground">
          현재 경로: {pathname}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="set-path-analytics"
            className="rounded-md border border-border/60 px-2 py-1 text-xs"
            onClick={() => setPathname("/dashboard/analytics")}
          >
            Analytics 경로로 설정
          </button>
          <button
            type="button"
            data-testid="set-path-people"
            className="rounded-md border border-border/60 px-2 py-1 text-xs"
            onClick={() => setPathname("/dashboard/people")}
          >
            People 경로로 설정
          </button>
          <button
            type="button"
            data-testid="set-path-attention"
            className="rounded-md border border-border/60 px-2 py-1 text-xs"
            onClick={() => setPathname("/dashboard/attention")}
          >
            Follow-ups 경로로 설정
          </button>
        </div>
        <DashboardTabs currentPathname={pathname} />
      </div>
    </AppRouterContext.Provider>
  );
}
