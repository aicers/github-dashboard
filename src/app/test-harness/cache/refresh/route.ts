import { NextResponse } from "next/server";

import { ensureActivityCaches } from "@/lib/activity/cache";
import {
  createDebugSurfaceDeniedResponse,
  isDebugSurfaceEnabled,
} from "@/lib/debug-surface";

async function handleRequest() {
  if (!isDebugSurfaceEnabled()) {
    return createDebugSurfaceDeniedResponse();
  }

  const caches = await ensureActivityCaches({ reason: "test-harness" });
  return NextResponse.json({
    success: true,
    refreshed: caches !== null,
    caches,
  });
}

export async function POST() {
  return handleRequest();
}

export async function GET() {
  return handleRequest();
}
