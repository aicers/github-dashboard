import { type NextRequest, NextResponse } from "next/server";

import { readActiveSession } from "@/lib/auth/session";
import { restoreDatabaseBackup } from "@/lib/backup/service";

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

  const idValue = Number.parseInt(id, 10);
  if (!Number.isFinite(idValue) || idValue <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid backup identifier." },
      { status: 400 },
    );
  }

  try {
    await restoreDatabaseBackup({
      backupId: idValue,
      actorId: session.userId ?? null,
    });

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
