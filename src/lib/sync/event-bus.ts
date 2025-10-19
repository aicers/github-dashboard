import type { SyncStreamEvent, SyncStreamListener } from "@/lib/sync/events";

type SyncEventGlobal = typeof globalThis & {
  __githubDashboardSyncListeners?: Set<SyncStreamListener>;
};

function getListenerSet(): Set<SyncStreamListener> {
  const globalRef = globalThis as SyncEventGlobal;
  if (!globalRef.__githubDashboardSyncListeners) {
    globalRef.__githubDashboardSyncListeners = new Set();
  }
  return globalRef.__githubDashboardSyncListeners;
}

export function subscribeToSyncEvents(listener: SyncStreamListener) {
  const listeners = getListenerSet();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function emitSyncEvent(event: SyncStreamEvent) {
  const listeners = Array.from(getListenerSet());
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(
        "[sync-event-bus] Failed to deliver sync event to listener",
        error,
      );
    }
  }
}

export function getSyncSubscriberCount() {
  return getListenerSet().size;
}
