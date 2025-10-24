import { NextResponse } from "next/server";

import { parseActivityListParams } from "@/lib/activity/params";
import { getActivityItems } from "@/lib/activity/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const params = parseActivityListParams(searchParams);

  try {
    const result = await getActivityItems(params);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load activity items", error);
    return NextResponse.json(
      { error: "Failed to load activity feed." },
      { status: 500 },
    );
  }
}
