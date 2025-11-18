import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyncStatusPanel } from "@/components/dashboard/sync-status-panel";
import type { SyncConnectionState } from "@/lib/sync/client-stream";
import type { SyncStreamEvent } from "@/lib/sync/events";
import { setDefaultFetchHandler } from "../../../tests/setup/mock-fetch";

const syncListeners = new Set<(event: SyncStreamEvent) => void>();
const connectionListeners = new Set<(state: SyncConnectionState) => void>();
let currentConnectionState: SyncConnectionState = "connecting";

vi.mock("@/lib/sync/client-stream", () => ({
  subscribeToSyncStream: (listener: (event: SyncStreamEvent) => void) => {
    syncListeners.add(listener);
    return () => {
      syncListeners.delete(listener);
    };
  },
  subscribeToSyncHeartbeat: () => () => {},
  subscribeToSyncConnectionState: (
    listener: (state: SyncConnectionState) => void,
  ) => {
    connectionListeners.add(listener);
    return () => {
      connectionListeners.delete(listener);
    };
  },
  getCurrentSyncConnectionState: () => currentConnectionState,
}));

function emitSyncEvent(event: SyncStreamEvent) {
  for (const listener of syncListeners) {
    listener(event);
  }
}

function setConnectionState(state: SyncConnectionState) {
  currentConnectionState = state;
  for (const listener of connectionListeners) {
    listener(state);
  }
}

describe("SyncStatusPanel", () => {
  beforeEach(() => {
    syncListeners.clear();
    connectionListeners.clear();
    currentConnectionState = "connecting";
    setDefaultFetchHandler({
      json: {
        success: true,
        status: {
          runs: [],
          logs: [],
        },
      },
    });
  });

  it("does not revive the in-progress banner when logs arrive after completion", async () => {
    render(<SyncStatusPanel />);

    await act(async () => {
      setConnectionState("open");
    });

    const runId = 101;
    const startedAt = new Date().toISOString();
    await act(async () => {
      emitSyncEvent({
        type: "run-started",
        runId,
        runType: "automatic",
        strategy: "incremental",
        status: "running",
        since: null,
        until: null,
        startedAt,
      });
    });

    await screen.findByText("Sync in progress");

    const completedAt = new Date(Date.now() + 1000).toISOString();
    await act(async () => {
      emitSyncEvent({
        type: "run-completed",
        runId,
        status: "success",
        completedAt,
        summary: {
          counts: {
            issues: 0,
            discussions: 0,
            pullRequests: 0,
            reviews: 0,
            comments: 0,
          },
          timestamps: {},
        },
      });
    });

    expect(screen.queryByText("Sync in progress")).not.toBeInTheDocument();

    await act(async () => {
      emitSyncEvent({
        type: "log-started",
        logId: 1,
        runId,
        resource: "activity-cache",
        status: "running",
        message: null,
        startedAt: new Date(Date.now() + 2000).toISOString(),
      });
    });

    expect(screen.queryByText("Sync in progress")).not.toBeInTheDocument();
  });
});
