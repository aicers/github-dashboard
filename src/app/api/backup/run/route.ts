import { type NextRequest, NextResponse } from "next/server";

import { checkReauthRequired } from "@/lib/auth/reauth-guard";
import { readActiveSession } from "@/lib/auth/session";
import { runDatabaseBackup } from "@/lib/backup/service";

export async function POST(_request: NextRequest) {
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
        message: "Administrator access required.",
      },
      { status: 403 },
    );
  }

  const needsReauth = await checkReauthRequired(
    _request,
    session,
    "backup_run",
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
}
