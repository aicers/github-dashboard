import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { runBackfill } from "@/lib/sync/service";

const requestSchema = z.object({
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
});

function buildLogger(prefix: string) {
  return (message: string) => {
    console.log(`[${prefix}] ${message}`);
  };
}

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
            "Administrator access is required to manage sync operations.",
        },
        { status: 403 },
      );
    }

    const payload = await request.json();
    const { startDate, endDate } = requestSchema.parse(payload);
    const result = await runBackfill(
      startDate,
      endDate ?? null,
      buildLogger("manual-backfill"),
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request payload.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error during backfill run.",
      },
      { status: 500 },
    );
  }
}
