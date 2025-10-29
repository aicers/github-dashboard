import { NextResponse } from "next/server";

import { getActivityItemDetail } from "@/lib/activity/service";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function parseMentionAi(value: string | null | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized.length) {
    return undefined;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  return undefined;
}

export async function GET(request: Request, context: RouteParams) {
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
    const url = new URL(request.url);
    const mentionParam =
      parseMentionAi(url.searchParams.get("mentionAi")) ??
      parseMentionAi(url.searchParams.get("useMentionAi"));
    const detail = await getActivityItemDetail(
      id,
      mentionParam === undefined
        ? undefined
        : { useMentionClassifier: mentionParam },
    );
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
