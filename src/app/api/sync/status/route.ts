import { NextResponse } from "next/server";

import { readActiveSession } from "@/lib/auth/session";
import { fetchSyncStatus } from "@/lib/sync/service";

export async function GET() {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const status = await fetchSyncStatus();
    return NextResponse.json({ success: true, status });
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
        message: "Unexpected error while fetching sync status.",
      },
      { status: 500 },
    );
  }
}
