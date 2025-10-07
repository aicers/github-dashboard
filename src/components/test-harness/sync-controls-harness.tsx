"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useMemo } from "react";

import { SyncControls } from "@/components/dashboard/sync-controls";
import type { SyncStatus } from "@/lib/sync/service";

type SyncControlsHarnessProps = {
  status: SyncStatus;
};

export function SyncControlsHarness({ status }: SyncControlsHarnessProps) {
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
      <SyncControls status={status} />
    </AppRouterContext.Provider>
  );
}
