import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SyncStatusPanel } from "@/components/dashboard/sync-status-panel";
import { setDefaultFetchHandler } from "../../../tests/setup/mock-fetch";

type SyncEventListener = (event: MessageEvent<string>) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<SyncEventListener>>();

  onopen: ((this: EventSource, ev: Event) => void) | null = null;

  onerror: ((this: EventSource, ev: Event) => void) | null = null;

  readyState = 0;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  static reset() {
    MockEventSource.instances = [];
  }

  addEventListener(type: string, listener: SyncEventListener) {
    const listeners = this.listeners.get(type) ?? new Set<SyncEventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: SyncEventListener) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    listeners.delete(listener);
    if (listeners.size === 0) {
      this.listeners.delete(type);
    }
  }

  close() {
    this.readyState = 2;
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.call(this as unknown as EventSource, {} as Event);
  }

  emitSync(payload: unknown) {
    this.dispatch("sync", JSON.stringify(payload));
  }

  private dispatch(type: string, data: string) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    const event = { data } as MessageEvent<string>;
    listeners.forEach((listener) => {
      listener(event);
    });
  }
}

describe("SyncStatusPanel", () => {
  beforeEach(() => {
    MockEventSource.reset();
    setDefaultFetchHandler({
      json: {
        success: true,
        status: {
          runs: [],
          logs: [],
        },
      },
    });
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    delete (globalThis as { EventSource?: typeof EventSource }).EventSource;
    MockEventSource.reset();
  });

  it("does not revive the in-progress banner when logs arrive after completion", async () => {
    render(<SyncStatusPanel />);

    const source = await waitFor(() => {
      const instance = MockEventSource.instances[0];
      expect(instance).toBeDefined();
      return instance;
    });

    await act(async () => {
      source.triggerOpen();
    });

    const runId = 101;
    const startedAt = new Date().toISOString();
    await act(async () => {
      source.emitSync({
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
      source.emitSync({
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

    await waitFor(() => {
      expect(screen.queryByText("Sync in progress")).not.toBeInTheDocument();
    });

    await act(async () => {
      source.emitSync({
        type: "log-started",
        logId: 1,
        runId,
        resource: "activity-cache",
        status: "running",
        message: null,
        startedAt: new Date(Date.now() + 2000).toISOString(),
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Sync in progress")).not.toBeInTheDocument();
    });
  });
});
