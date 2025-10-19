import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { runPrLinkBackfill } from "@/lib/sync/service";

const schema = z.object({
  startDate: z.string(),
  endDate: z.string().optional(),
});

function buildLogger(prefix: string) {
  return (message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${prefix}] ${message}`);
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

    const payload = schema.parse(await request.json());
    const result = await runPrLinkBackfill(
      payload.startDate,
      payload.endDate,
      buildLogger("pr-link-backfill"),
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
        message: "Unexpected error during PR link backfill.",
      },
      { status: 500 },
    );
  }
}
