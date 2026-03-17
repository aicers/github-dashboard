import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readActiveSession } from "@/lib/auth/session";
import type { SessionRecord } from "@/lib/auth/session-store";
import { emitSyncEvent, getSyncSubscriberCount } from "@/lib/sync/event-bus";
import type { SyncStreamEvent } from "@/lib/sync/events";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

vi.mock("@/lib/sync/event-bus", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/event-bus")>(
    "@/lib/sync/event-bus",
  );

  return {
    ...actual,
    getSyncSubscriberCount: vi.fn(() => actual.getSyncSubscriberCount()),
  };
});

const readActiveSessionMock = vi.mocked(readActiveSession);
const getSyncSubscriberCountMock = vi.mocked(getSyncSubscriberCount);

function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const base = {
    id: "session-1",
    userId: "user-1",
    orgSlug: "acme",
    orgVerified: true,
    isAdmin: false,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2024-01-01T01:00:00.000Z"),
    expiresAt: new Date("2024-01-01T12:00:00.000Z"),
    refreshExpiresAt: new Date("2024-01-02T00:00:00.000Z"),
    maxExpiresAt: new Date("2024-02-01T00:00:00.000Z"),
    lastReauthAt: new Date("2024-01-01T00:00:00.000Z"),
    deviceId: "device-1",
    ipCountry: "KR",
  };

  return { ...base, ...overrides };
}

describe("GET /api/sync/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readActiveSessionMock.mockResolvedValue(buildSession());
  });

  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);
    const { GET } = await import("./route");

    const request = new NextRequest("http://localhost/api/sync/stream");
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
  });

  it("returns a server-sent events stream and forwards sync events", async () => {
    const { GET } = await import("./route");
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

  it("returns 429 when too many subscribers are already connected", async () => {
    const { GET, SYNC_STREAM_MAX_SUBSCRIBERS } = await import("./route");
    getSyncSubscriberCountMock.mockReturnValueOnce(SYNC_STREAM_MAX_SUBSCRIBERS);

    const request = new NextRequest("http://localhost/api/sync/stream");
    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({
      success: false,
      message:
        "Too many sync stream connections are already active. Please try again shortly.",
    });
  });
});
