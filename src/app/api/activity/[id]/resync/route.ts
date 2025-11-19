import { NextResponse } from "next/server";

import { resyncActivityItem } from "@/lib/activity/item-resync";
import { readActiveSession } from "@/lib/auth/session";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: RouteParams) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

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
    const summary = await resyncActivityItem(id);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to re-import activity item.";
    const normalized = message.trim().length
      ? message
      : "Failed to re-import activity item.";
    const status =
      error instanceof Error &&
      /not found|unsupported|missing/i.test(error.message)
        ? 404
        : 500;
    return NextResponse.json({ error: normalized }, { status });
  }
}
