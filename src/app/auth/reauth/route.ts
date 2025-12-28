import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function sanitizeReturnPath(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith("/")) {
    return null;
  }
  if (value.startsWith("//")) {
    return null;
  }
  return value;
}

export async function GET(request: NextRequest) {
  const requestedReturnPath = sanitizeReturnPath(
    request.nextUrl.searchParams.get("next"),
  );
  const redirectTarget = requestedReturnPath
    ? `/auth/github?next=${encodeURIComponent(requestedReturnPath)}`
    : "/auth/github";
  return NextResponse.redirect(new URL(redirectTarget, request.nextUrl));
}
