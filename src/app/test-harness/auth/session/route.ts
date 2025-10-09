import { NextResponse } from "next/server";

import { establishSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";
import type { DbActor } from "@/lib/db/operations";
import { upsertUser } from "@/lib/db/operations";

function allowHarnessAccess() {
  return process.env.NODE_ENV !== "production";
}

function buildActor({
  id,
  login,
  name,
}: {
  id: string;
  login: string;
  name: string;
}): DbActor {
  const timestamp = new Date().toISOString();
  return {
    id,
    login,
    name,
    avatarUrl: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    __typename: "User",
  };
}

export async function GET(request: Request) {
  if (!allowHarnessAccess()) {
    return NextResponse.json({ success: false }, { status: 404 });
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? "test-user";
  const login = url.searchParams.get("login") ?? userId;
  const name = url.searchParams.get("name") ?? login;
  const orgSlug = url.searchParams.get("org") ?? "test-org";
  const isAdminParam = url.searchParams.get("admin");
  const isAdmin =
    typeof isAdminParam === "string"
      ? ["true", "1", "yes"].includes(isAdminParam.toLowerCase())
      : false;

  await ensureSchema();
  await upsertUser(buildActor({ id: userId, login, name }));

  const { cookie } = await establishSession({
    userId,
    orgSlug,
    orgVerified: true,
    isAdmin,
  });

  const response = NextResponse.json({
    success: true,
    userId,
  });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
