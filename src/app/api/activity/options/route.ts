import { NextResponse } from "next/server";

import { getActivityFilterOptions } from "@/lib/activity/service";

export async function GET() {
  try {
    const options = await getActivityFilterOptions();
    return NextResponse.json(options);
  } catch (error) {
    console.error("Failed to load activity filter options", error);
    return NextResponse.json(
      { error: "Failed to load activity filters." },
      { status: 500 },
    );
  }
}
