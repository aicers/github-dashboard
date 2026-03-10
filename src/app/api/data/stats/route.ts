import { NextResponse } from "next/server";

import { authenticatedRoute } from "@/lib/api/route-handler";
import { fetchDashboardStats } from "@/lib/sync/service";

export const GET = authenticatedRoute(async () => {
  try {
    const stats = await fetchDashboardStats();
    return NextResponse.json({ success: true, stats });
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
        message: "Unexpected error while fetching dashboard stats.",
      },
      { status: 500 },
    );
  }
});
