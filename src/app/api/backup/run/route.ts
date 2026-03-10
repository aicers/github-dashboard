import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import { runDatabaseBackup } from "@/lib/backup/service";

export const POST = adminRoute("backup_run", async (_request, session) => {
  try {
    await runDatabaseBackup({
      trigger: "manual",
      actorId: session.userId ?? null,
    });

    return NextResponse.json({
      success: true,
      message: "Backup completed successfully.",
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, message: "Unexpected error while running backup." },
      { status: 500 },
    );
  }
});
