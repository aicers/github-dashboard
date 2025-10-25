"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useMemo } from "react";

import { SyncControls } from "@/components/dashboard/sync-controls";
import type { SyncStatus } from "@/lib/sync/service";

type SyncControlsHarnessProps = {
  status: SyncStatus;
  isAdmin?: boolean;
  view?: "overview" | "logs" | "backup";
  currentPathname?: string;
};

export function SyncControlsHarness({
  status,
  isAdmin = true,
  view = "overview",
  currentPathname = "/dashboard/sync",
}: SyncControlsHarnessProps) {
  const router = useMemo<AppRouterInstance>(
    () => ({
      back: () => {},
      forward: () => {},
      prefetch: async () => {},
      push: () => {},
      replace: () => {},
      refresh: () => {},
    }),
    [],
  );

  return (
    <AppRouterContext.Provider value={router}>
      <SyncControls
        status={status}
        isAdmin={isAdmin}
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view={view}
        currentPathname={currentPathname}
      />
    </AppRouterContext.Provider>
  );
}
