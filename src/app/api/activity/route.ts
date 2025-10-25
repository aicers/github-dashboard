import { NextResponse } from "next/server";
import { parseActivityListParams } from "@/lib/activity/params";
import { getActivityItems } from "@/lib/activity/service";
import { readActiveSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const params = parseActivityListParams(searchParams);

  try {
    const session = await readActiveSession();
    const result = await getActivityItems(params, {
      userId: session?.userId ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load activity items", error);
    return NextResponse.json(
      { error: "Failed to load activity feed." },
      { status: 500 },
    );
  }
}
