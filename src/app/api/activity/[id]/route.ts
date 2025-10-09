import { NextResponse } from "next/server";

import { getActivityItemDetail } from "@/lib/activity/service";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: RouteParams) {
  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const id = decodeURIComponent(rawId.trim());
  if (!id) {
    return NextResponse.json(
      { error: "Invalid activity id." },
      { status: 400 },
    );
  }

  try {
    const detail = await getActivityItemDetail(id);
    if (!detail) {
      return NextResponse.json(
        { error: "Activity item not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error("Failed to load activity item", error);
    return NextResponse.json(
      { error: "Failed to load activity detail." },
      { status: 500 },
    );
  }
}
