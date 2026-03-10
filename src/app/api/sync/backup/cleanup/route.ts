import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import { cleanupDatabaseBackup } from "@/lib/backup/service";

export const POST = adminRoute("backup_cleanup", async (_request, session) => {
  try {
    const result = await cleanupDatabaseBackup({ actorId: session.userId });
    return NextResponse.json({
      success: true,
      message: "Database backup marked as failed and reset.",
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
        message: "Unexpected error while cleaning up database backup.",
      },
      { status: 500 },
    );
  }
});
