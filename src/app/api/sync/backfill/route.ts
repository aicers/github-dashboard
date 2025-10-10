import { NextResponse } from "next/server";
import { z } from "zod";

import { runBackfill } from "@/lib/sync/service";

const requestSchema = z.object({
  startDate: z.string(),
});

function buildLogger(prefix: string) {
  return (message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${prefix}] ${message}`);
  };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { startDate } = requestSchema.parse(payload);
    const result = await runBackfill(startDate, buildLogger("manual-backfill"));

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
