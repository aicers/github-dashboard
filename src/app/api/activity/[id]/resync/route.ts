import { NextResponse } from "next/server";

import { resyncActivityItem } from "@/lib/activity/item-resync";
import {
  consumeRateLimit,
  createRetryAfterHeaders,
} from "@/lib/api/rate-limit";
import { getMutationRequestViolation } from "@/lib/api/request-guards";
import { readActiveSession } from "@/lib/auth/session";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export const ACTIVITY_RESYNC_RATE_LIMIT_MAX_REQUESTS = 10;
export const ACTIVITY_RESYNC_RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(request: Request, context: RouteParams) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const mutationViolation = getMutationRequestViolation(request);
  if (mutationViolation) {
    return NextResponse.json({ error: mutationViolation }, { status: 403 });
  }

  const rateLimit = consumeRateLimit({
    scope: "activity-resync",
    key: session.userId,
    limit: ACTIVITY_RESYNC_RATE_LIMIT_MAX_REQUESTS,
    windowMs: ACTIVITY_RESYNC_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many resync requests. Please try again shortly." },
      {
        status: 429,
        headers: createRetryAfterHeaders(rateLimit.retryAfterSeconds),
      },
    );
  }

  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const id = decodeURIComponent(rawId.trim());
  if (!id) {
    return NextResponse.json(
      { error: "Invalid activity id." },
      { status: 400 },
    );
  }

  try {
    const summary = await resyncActivityItem(id);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to re-import activity item.";
    const normalized = message.trim().length
      ? message
      : "Failed to re-import activity item.";
    const status =
      error instanceof Error &&
      /not found|unsupported|missing/i.test(error.message)
        ? 404
        : 500;
    return NextResponse.json({ error: normalized }, { status });
  }
}
