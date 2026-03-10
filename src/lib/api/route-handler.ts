import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ReauthAction } from "@/lib/auth/reauth";
import { checkReauthRequired } from "@/lib/auth/reauth-guard";
import type { ActiveSession } from "@/lib/auth/session";
import { readActiveSession } from "@/lib/auth/session";

export type RouteContext<
  P extends Record<string, string> = Record<string, string>,
> = {
  params: Promise<P>;
};

// ---- Shared error responses ----

function unauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, message: "Authentication required." },
    { status: 401 },
  );
}

function forbidden(): NextResponse {
  return NextResponse.json(
    { success: false, message: "Administrator access is required." },
    { status: 403 },
  );
}

function reauthNeeded(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      message: "Reauthentication required.",
      reauthRequired: true,
    },
    { status: 428 },
  );
}

// ---- authenticatedRoute ----
//
// Wraps a route handler with a session check. Passes the active session as the
// second argument. Supports both plain routes and dynamic routes with params.

export function authenticatedRoute(
  handler: (request: Request, session: ActiveSession) => Promise<Response>,
): (request: Request) => Promise<Response>;

export function authenticatedRoute<P extends Record<string, string>>(
  handler: (
    request: Request,
    session: ActiveSession,
    context: RouteContext<P>,
  ) => Promise<Response>,
): (request: Request, context: RouteContext<P>) => Promise<Response>;

// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires flexible typing
export function authenticatedRoute(handler: any): any {
  return async (
    request: Request,
    context?: RouteContext,
  ): Promise<Response> => {
    const session = await readActiveSession();
    if (!session) {
      return unauthorized();
    }
    return handler(request, session, context);
  };
}

// ---- adminRoute ----
//
// Wraps a route handler with a session check, an admin check, and an optional
// reauthentication check. Passes the active session as the second argument.
// Supports both plain routes and dynamic routes with params.

// Without reauth, no context
export function adminRoute(
  handler: (request: NextRequest, session: ActiveSession) => Promise<Response>,
): (request: NextRequest) => Promise<Response>;

// Without reauth, with context
export function adminRoute<P extends Record<string, string>>(
  handler: (
    request: NextRequest,
    session: ActiveSession,
    context: RouteContext<P>,
  ) => Promise<Response>,
): (request: NextRequest, context: RouteContext<P>) => Promise<Response>;

// With reauth, no context
export function adminRoute(
  reauthAction: string,
  handler: (request: NextRequest, session: ActiveSession) => Promise<Response>,
): (request: NextRequest) => Promise<Response>;

// With reauth, with context
export function adminRoute<P extends Record<string, string>>(
  reauthAction: string,
  handler: (
    request: NextRequest,
    session: ActiveSession,
    context: RouteContext<P>,
  ) => Promise<Response>,
): (request: NextRequest, context: RouteContext<P>) => Promise<Response>;

// Implementation
// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires flexible typing
export function adminRoute(reauthActionOrHandler: any, handlerArg?: any): any {
  const reauthAction =
    typeof reauthActionOrHandler === "string"
      ? (reauthActionOrHandler as ReauthAction)
      : undefined;
  const handler = (
    typeof reauthActionOrHandler === "function"
      ? reauthActionOrHandler
      : handlerArg
  ) as (
    request: NextRequest,
    session: ActiveSession,
    context?: RouteContext,
  ) => Promise<Response>;

  return async (
    request: NextRequest,
    context?: RouteContext,
  ): Promise<Response> => {
    const session = await readActiveSession();
    if (!session) {
      return unauthorized();
    }
    if (!session.isAdmin) {
      return forbidden();
    }
    if (reauthAction) {
      const needsReauth = await checkReauthRequired(
        request,
        session,
        reauthAction,
      );
      if (needsReauth) {
        return reauthNeeded();
      }
    }
    return handler(request, session, context);
  };
}
