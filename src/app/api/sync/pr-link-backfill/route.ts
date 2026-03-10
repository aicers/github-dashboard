import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute } from "@/lib/api/route-handler";
import { runPrLinkBackfill } from "@/lib/sync/service";

const schema = z.object({
  startDate: z.string(),
  endDate: z.string().optional(),
});

function buildLogger(prefix: string) {
  return (message: string) => {
    console.log(`[${prefix}] ${message}`);
  };
}

export const POST = adminRoute(async (request, _session) => {
  try {
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
});
