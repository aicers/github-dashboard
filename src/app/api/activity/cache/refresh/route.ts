import { NextResponse } from "next/server";
import { z } from "zod";

import { refreshActivityCaches } from "@/lib/activity/cache";
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
            "Administrator access is required to refresh cached activity data.",
        },
        { status: 403 },
      );
    }

    const payload = requestSchema.parse(
      await request.json().catch(() => undefined),
    );

    const result = await refreshActivityCaches({
      runId: null,
      reason: payload?.reason ?? "manual",
    });

    return NextResponse.json({
      success: true,
      caches: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid refresh request payload.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      console.error("[activity-cache] Manual refresh failed", error);
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while refreshing activity caches.",
      },
      { status: 500 },
    );
  }
}
