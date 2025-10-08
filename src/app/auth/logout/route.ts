import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { buildReturnCookie, buildStateCookie } from "@/lib/auth/github";
import { destroySessionCookie } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const clearedSessionCookie = await destroySessionCookie();
  const clearedStateCookie = buildStateCookie("", { maxAge: 0 });
  const clearedReturnCookie = buildReturnCookie("", { maxAge: 0 });

  const redirectTarget = new URL("/", request.nextUrl);
  const response = NextResponse.redirect(redirectTarget);

  response.cookies.set(
    clearedSessionCookie.name,
    clearedSessionCookie.value,
    clearedSessionCookie.options,
  );
  response.cookies.set(
    clearedStateCookie.name,
    clearedStateCookie.value,
    clearedStateCookie.options,
  );
  response.cookies.set(
    clearedReturnCookie.name,
    clearedReturnCookie.value,
    clearedReturnCookie.options,
  );

  return response;
}
