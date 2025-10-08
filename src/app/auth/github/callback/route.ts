import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  buildReturnCookie,
  buildStateCookie,
  exchangeCodeForToken,
  fetchGithubProfile,
  GITHUB_RETURN_COOKIE,
  GITHUB_STATE_COOKIE,
  persistGithubProfile,
  verifyOrganizationMembership,
} from "@/lib/auth/github";
import { establishSession } from "@/lib/auth/session";
import { buildClearedSessionCookie } from "@/lib/auth/session-cookie";
import { env } from "@/lib/env";

function resolveBaseUrl(request: NextRequest) {
  return env.APP_BASE_URL ?? request.nextUrl.origin;
}

function clearStateCookie(response: NextResponse) {
  const cleared = buildStateCookie("", { maxAge: 0 });
  response.cookies.set(cleared.name, cleared.value, cleared.options);
}

function clearReturnCookie(response: NextResponse) {
  const cleared = buildReturnCookie("", { maxAge: 0 });
  response.cookies.set(cleared.name, cleared.value, cleared.options);
}

function clearTransientOAuthCookies(response: NextResponse) {
  clearStateCookie(response);
  clearReturnCookie(response);
}

function resolveReturnPath(request: NextRequest) {
  const stored = request.cookies.get(GITHUB_RETURN_COOKIE)?.value ?? null;
  if (!stored || !stored.startsWith("/") || stored.startsWith("//")) {
    return "/dashboard";
  }

  return stored;
}

function clearAuthCookies(response: NextResponse) {
  clearTransientOAuthCookies(response);
  const clearedSession = buildClearedSessionCookie();
  response.cookies.set(
    clearedSession.name,
    clearedSession.value,
    clearedSession.options,
  );
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    const response = NextResponse.json(
      {
        error: "GitHub returned an error during authorization.",
        details: errorDescription ?? error,
      },
      { status: 400 },
    );
    clearAuthCookies(response);
    return response;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    const response = NextResponse.json(
      { error: "Missing code or state from GitHub callback." },
      { status: 400 },
    );
    clearAuthCookies(response);
    return response;
  }

  const storedState = request.cookies.get(GITHUB_STATE_COOKIE)?.value ?? null;
  const stateIsValid = Boolean(storedState && storedState === state);
  if (!stateIsValid) {
    const response = NextResponse.json(
      { error: "OAuth state mismatch. Please try signing in again." },
      { status: 400 },
    );
    clearAuthCookies(response);
    return response;
  }

  try {
    const redirectUri = new URL(
      "/auth/github/callback",
      resolveBaseUrl(request),
    ).toString();
    const accessToken = await exchangeCodeForToken({
      code,
      redirectUri,
      state,
    });
    const profile = await fetchGithubProfile(accessToken);
    const membership = await verifyOrganizationMembership(
      accessToken,
      profile.actor.login ?? "",
    );

    if (!membership.allowed) {
      const deniedUrl = new URL("/auth/denied", resolveBaseUrl(request));
      const response = NextResponse.redirect(deniedUrl);
      clearAuthCookies(response);
      return response;
    }

    await persistGithubProfile(profile);

    const { cookie: sessionCookie } = await establishSession({
      userId: profile.actor.id,
      orgSlug: membership.orgSlug,
      orgVerified: true,
    });

    const targetPath = resolveReturnPath(request);
    const redirectTarget = new URL(targetPath, resolveBaseUrl(request));
    const response = NextResponse.redirect(redirectTarget);
    response.cookies.set(
      sessionCookie.name,
      sessionCookie.value,
      sessionCookie.options,
    );
    clearTransientOAuthCookies(response);
    return response;
  } catch (oauthError) {
    console.error("GitHub OAuth callback failed:", oauthError);
    const response = NextResponse.json(
      {
        error: "Unable to complete GitHub authentication.",
      },
      { status: 500 },
    );
    clearAuthCookies(response);
    return response;
  }
}
