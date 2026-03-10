import { NextResponse } from "next/server";

import { authenticatedRoute } from "@/lib/api/route-handler";
import { fetchSyncStatus } from "@/lib/sync/service";

export const GET = authenticatedRoute(async () => {
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
});
