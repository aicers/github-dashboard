import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getActivitySnapshotSummary,
  refreshActivityItemsSnapshot,
} from "@/lib/activity/snapshot";
import { readActiveSession } from "@/lib/auth/session";

const requestSchema = z
  .object({
    reason: z.string().trim().min(1).max(120).optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    const session = await readActiveSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required." },
        { status: 401 },
      );
    }

    if (!session.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Administrator access is required to rebuild Activity snapshots.",
        },
        { status: 403 },
      );
    }

    await requestSchema.parseAsync(await request.json().catch(() => undefined));

    await refreshActivityItemsSnapshot({ truncate: true });
    const summary = await getActivitySnapshotSummary();

    return NextResponse.json({ success: true, summary, result: summary });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid snapshot refresh payload.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      console.error("[activity-snapshot] Manual refresh failed", error);
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while rebuilding the Activity snapshot.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const session = await readActiveSession();
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required." },
        { status: 401 },
      );
    }

    if (!session.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Administrator access is required to view Activity snapshot details.",
        },
        { status: 403 },
      );
    }

    const summary = await getActivitySnapshotSummary();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        "[activity-snapshot] Failed to load snapshot summary",
        error,
      );
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while loading Activity snapshot state.",
      },
      { status: 500 },
    );
  }
}
