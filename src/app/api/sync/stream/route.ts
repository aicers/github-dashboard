import { authenticatedRoute } from "@/lib/api/route-handler";
import {
  getSyncSubscriberCount,
  subscribeToSyncEvents,
} from "@/lib/sync/event-bus";
import type { SyncStreamEvent } from "@/lib/sync/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 25_000;
export const SYNC_STREAM_MAX_SUBSCRIBERS = 25;

function encodeEvent(eventName: string, payload: unknown) {
  const data =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  return encoder.encode(`event: ${eventName}\ndata: ${data}\n\n`);
}

function encodeComment(comment: string) {
  return encoder.encode(`: ${comment}\n\n`);
}

function encodeRetry(delayMs: number) {
  return encoder.encode(`retry: ${delayMs}\n\n`);
}

export const GET = authenticatedRoute(async (request) => {
  if (getSyncSubscriberCount() >= SYNC_STREAM_MAX_SUBSCRIBERS) {
    return Response.json(
      {
        success: false,
        message:
          "Too many sync stream connections are already active. Please try again shortly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": "5",
        },
      },
    );
  }

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let heartbeatTimer: NodeJS.Timeout | null = null;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        request.signal?.removeEventListener("abort", close);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        unsubscribe();
        try {
          controller.close();
        } catch (_error) {
          // stream already closed
        }
      };

      const sendChunk = (chunk: Uint8Array) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(chunk);
        } catch (error) {
          console.error("[sync-stream] Failed to enqueue chunk", error);
          close();
        }
      };

      sendChunk(encodeComment("connected"));
      sendChunk(encodeRetry(5000));

      const heartbeatPayload = () => ({
        timestamp: new Date().toISOString(),
        subscribers: getSyncSubscriberCount(),
      });
      sendChunk(encodeEvent("heartbeat", heartbeatPayload()));

      const handleSyncEvent = (event: SyncStreamEvent) => {
        sendChunk(encodeEvent("sync", event));
      };

      unsubscribe = subscribeToSyncEvents(handleSyncEvent);

      heartbeatTimer = setInterval(() => {
        sendChunk(encodeEvent("heartbeat", heartbeatPayload()));
      }, HEARTBEAT_INTERVAL_MS);

      cleanup = close;
      request.signal?.addEventListener("abort", close);
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
