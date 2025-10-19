import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { emitSyncEvent } from "@/lib/sync/event-bus";
import type { SyncStreamEvent } from "@/lib/sync/events";

import { GET } from "./route";

describe("GET /api/sync/stream", () => {
  it("returns a server-sent events stream and forwards sync events", async () => {
    const request = new NextRequest("http://localhost/api/sync/stream");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(response.headers.get("connection")).toBe("keep-alive");

    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected readable stream from response.");
    }

    let heartbeatReceived = false;
    for (let index = 0; index < 3; index += 1) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      const chunk = decoder.decode(value ?? new Uint8Array());
      if (chunk.includes("event: heartbeat")) {
        heartbeatReceived = true;
        break;
      }
    }

    expect(heartbeatReceived).toBe(true);

    const event: SyncStreamEvent = {
      type: "run-started",
      runId: 123,
      runType: "manual",
      strategy: "incremental",
      status: "running",
      since: null,
      until: null,
      startedAt: new Date().toISOString(),
    };

    emitSyncEvent(event);
    // Allow the stream to flush.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    const { value: eventChunk, done: eventDone } = await reader.read();
    expect(eventDone).toBe(false);
    const eventPayload = decoder.decode(eventChunk ?? new Uint8Array());
    expect(eventPayload).toContain("event: sync");
    expect(eventPayload).toContain('"type":"run-started"');
    expect(eventPayload).toContain('"runId":123');

    await reader.cancel();
  });
});
