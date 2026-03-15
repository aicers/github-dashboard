"use client";

import { useEffect } from "react";
import { subscribeToSyncStream } from "@/lib/sync/client-stream";
import type { SyncStreamEvent } from "@/lib/sync/events";

/**
 * Subscribes to the sync event stream for the lifetime of the calling component.
 * The listener is re-subscribed whenever the callback identity changes.
 */
export function useSyncStream(
  listener: (event: SyncStreamEvent) => void,
): void {
  useEffect(() => {
    return subscribeToSyncStream(listener);
  }, [listener]);
}
