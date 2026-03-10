import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import { cleanupStuckSyncRuns } from "@/lib/sync/service";

export const POST = adminRoute("sync_cleanup", async (_request, session) => {
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
});
