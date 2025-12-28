import { type NextRequest, NextResponse } from "next/server";

import { checkReauthRequired } from "@/lib/auth/reauth-guard";
import { readActiveSession } from "@/lib/auth/session";
import { cleanupStuckSyncRuns } from "@/lib/sync/service";

export async function POST(request: NextRequest) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  if (!session.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        message: "Administrator access is required to manage sync operations.",
      },
      { status: 403 },
    );
  }

  const needsReauth = await checkReauthRequired(
    request,
    session,
    "sync_cleanup",
  );
  if (needsReauth) {
    return NextResponse.json(
      {
        success: false,
        message: "Reauthentication required.",
        reauthRequired: true,
      },
      { status: 428 },
    );
  }

  try {
    const result = await cleanupStuckSyncRuns({ actorId: session.userId });
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while cleaning up running syncs.",
      },
      { status: 500 },
    );
  }
}
