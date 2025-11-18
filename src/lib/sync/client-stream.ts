"use client";

import type { SyncStreamEvent } from "@/lib/sync/events";

export type SyncConnectionState = "idle" | "connecting" | "open" | "retrying";

export type SyncHeartbeatPayload = {
  timestamp?: string;
  subscribers?: number;
};

type SyncListener = (event: SyncStreamEvent) => void;
type HeartbeatListener = (event: SyncHeartbeatPayload) => void;
type ConnectionListener = (state: SyncConnectionState) => void;

const syncListeners = new Set<SyncListener>();
const heartbeatListeners = new Set<HeartbeatListener>();
const connectionListeners = new Set<ConnectionListener>();

let connectionState: SyncConnectionState = "idle";
let source: EventSource | null = null;

function notifyListeners<T>(listeners: Set<(payload: T) => void>, payload: T) {
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error("[sync-client-stream] Listener execution failed", error);
    }
  });
}

function updateConnectionState(nextState: SyncConnectionState) {
  if (connectionState === nextState) {
    return;
  }
  connectionState = nextState;
  notifyListeners(connectionListeners, nextState);
}

function hasActiveListeners() {
  return (
    syncListeners.size > 0 ||
    heartbeatListeners.size > 0 ||
    connectionListeners.size > 0
  );
}

function teardownEventSource() {
  if (source && !hasActiveListeners()) {
    source.close();
    source = null;
    connectionState = "idle";
  }
}

function ensureEventSource() {
  if (typeof window === "undefined") {
    return;
  }
  if (source) {
    return;
  }

  updateConnectionState("connecting");
  source = new EventSource("/api/sync/stream");

  source.onopen = () => {
    updateConnectionState("open");
  };

  source.onerror = () => {
    updateConnectionState("retrying");
  };

  source.addEventListener("sync", (event) => {
    try {
      const payload = JSON.parse(event.data) as SyncStreamEvent;
      notifyListeners(syncListeners, payload);
    } catch (error) {
      console.error("[sync-client-stream] Failed to parse sync event", {
        error,
        data: event.data,
      });
    }
  });

  source.addEventListener("heartbeat", (event) => {
    try {
      const payload = JSON.parse(event.data) as SyncHeartbeatPayload;
      notifyListeners(heartbeatListeners, payload);
    } catch (error) {
      console.error("[sync-client-stream] Failed to parse heartbeat", {
        error,
        data: event.data,
      });
    }
  });
}

export function subscribeToSyncStream(listener: SyncListener) {
  syncListeners.add(listener);
  ensureEventSource();
  return () => {
    syncListeners.delete(listener);
    teardownEventSource();
  };
}

export function subscribeToSyncHeartbeat(listener: HeartbeatListener) {
  heartbeatListeners.add(listener);
  ensureEventSource();
  return () => {
    heartbeatListeners.delete(listener);
    teardownEventSource();
  };
}

export function subscribeToSyncConnectionState(listener: ConnectionListener) {
  connectionListeners.add(listener);
  ensureEventSource();
  return () => {
    connectionListeners.delete(listener);
    teardownEventSource();
  };
}

export function getCurrentSyncConnectionState(): SyncConnectionState {
  return connectionState;
}
