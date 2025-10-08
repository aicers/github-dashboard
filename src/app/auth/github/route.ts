import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  buildAuthorizeUrl,
  buildReturnCookie,
  buildStateCookie,
  createOAuthState,
} from "@/lib/auth/github";
import { env } from "@/lib/env";

function resolveBaseUrl(request: NextRequest) {
  return env.APP_BASE_URL ?? request.nextUrl.origin;
}

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
  try {
    const state = createOAuthState();
    const stateCookie = buildStateCookie(state);
    const requestedReturnPath = sanitizeReturnPath(
      request.nextUrl.searchParams.get("next"),
    );
    const returnCookie = requestedReturnPath
      ? buildReturnCookie(requestedReturnPath)
      : buildReturnCookie("", { maxAge: 0 });

    const redirectUri = new URL(
      "/auth/github/callback",
      resolveBaseUrl(request),
    ).toString();
    const authorizeUrl = buildAuthorizeUrl({ state, redirectUri });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(
      stateCookie.name,
      stateCookie.value,
      stateCookie.options,
    );
    response.cookies.set(
      returnCookie.name,
      returnCookie.value,
      returnCookie.options,
    );

    return response;
  } catch (error) {
    console.error("Failed to initiate GitHub OAuth flow:", error);
    return NextResponse.json(
      { error: "GitHub OAuth is not configured." },
      { status: 500 },
    );
  }
}
