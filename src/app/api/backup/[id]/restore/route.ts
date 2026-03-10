import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import {
  parseBackupRestoreKey,
  restoreDatabaseBackup,
} from "@/lib/backup/service";

export const POST = adminRoute<{ id: string }>(
  "backup_restore",
  async (_request, session, context) => {
    const { id } = await context.params;

    const parsedKey = parseBackupRestoreKey(id);
    if (!parsedKey) {
      return NextResponse.json(
        { success: false, message: "Invalid backup identifier." },
        { status: 400 },
      );
    }

    try {
      if (parsedKey.type === "database") {
        await restoreDatabaseBackup({
          backupId: parsedKey.id,
          actorId: session.userId ?? null,
        });
      } else {
        await restoreDatabaseBackup({
          filePath: parsedKey.filePath,
          actorId: session.userId ?? null,
        });
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { success: false, message: "Unexpected error during restore." },
        { status: 500 },
      );
    }
  },
);
