import { type NextRequest, NextResponse } from "next/server";

import { checkReauthRequired } from "@/lib/auth/reauth-guard";
import { readActiveSession } from "@/lib/auth/session";
import {
  parseBackupRestoreKey,
  restoreDatabaseBackup,
} from "@/lib/backup/service";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  if (!session.isAdmin) {
    return NextResponse.json(
      { success: false, message: "Administrator access required." },
      { status: 403 },
    );
  }

  const needsReauth = await checkReauthRequired(
    _request,
    session,
    "backup_restore",
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
}
