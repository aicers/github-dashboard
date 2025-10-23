import { NextResponse } from "next/server";

import { parseActivityListParams } from "@/lib/activity/params";
import {
  ActivityMetadataError,
  getActivityItems,
  getActivityMetadata,
} from "@/lib/activity/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const params = parseActivityListParams(searchParams);

  try {
    if (params.mode === "summary") {
      const result = await getActivityMetadata(params);
      return NextResponse.json(result);
    }
    const result = await getActivityItems(params);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ActivityMetadataError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to load activity items", error);
    return NextResponse.json(
      { error: "Failed to load activity feed." },
      { status: 500 },
    );
  }
}
