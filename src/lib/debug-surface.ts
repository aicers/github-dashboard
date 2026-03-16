import { notFound } from "next/navigation";
import { NextResponse } from "next/server";

/**
 * Debug and test-only surfaces must stay unreachable in production.
 */
export function isDebugSurfaceEnabled() {
  return process.env.NODE_ENV !== "production";
}

export function assertDebugSurfaceEnabled() {
  if (!isDebugSurfaceEnabled()) {
    notFound();
  }
}

export function createDebugSurfaceDeniedResponse() {
  return NextResponse.json({ success: false }, { status: 404 });
}
