import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitSyncEvent,
  getSyncSubscriberCount,
  subscribeToSyncEvents,
} from "@/lib/sync/event-bus";
import type { SyncStreamEvent } from "@/lib/sync/events";

describe("sync event bus", () => {
  const subscriptions: Array<() => void> = [];

  afterEach(() => {
    while (subscriptions.length > 0) {
      const dispose = subscriptions.pop();
      dispose?.();
    }
  });

  it("delivers events to subscribers", () => {
    const received: SyncStreamEvent[] = [];
    const unsubscribe = subscribeToSyncEvents((event) => {
      received.push(event);
    });
    subscriptions.push(unsubscribe);

    expect(getSyncSubscriberCount()).toBeGreaterThan(0);

    const payload: SyncStreamEvent = {
      type: "heartbeat",
      timestamp: new Date().toISOString(),
    };

    emitSyncEvent(payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });

  it("continues delivering events if a subscriber throws", () => {
    const spy = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const unsubscribeThrowing = subscribeToSyncEvents(() => {
      throw new Error("listener failure");
    });
    subscriptions.push(unsubscribeThrowing);

    const unsubscribeHealthy = subscribeToSyncEvents((event) => {
      spy(event);
    });
    subscriptions.push(unsubscribeHealthy);

    const payload: SyncStreamEvent = {
      type: "heartbeat",
      timestamp: new Date().toISOString(),
    };

    expect(() => emitSyncEvent(payload)).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(payload);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
