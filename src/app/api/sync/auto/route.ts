import { NextResponse } from "next/server";
import { z } from "zod";

import { disableAutomaticSync, enableAutomaticSync } from "@/lib/sync/service";

const requestSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().positive().optional(),
});

function buildLogger(prefix: string) {
  return (message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${prefix}] ${message}`);
  };
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());

    if (payload.enabled) {
      const result = await enableAutomaticSync({
        intervalMinutes: payload.intervalMinutes,
        logger: buildLogger("auto-sync"),
      });

      return NextResponse.json({
        success: true,
        action: "enabled",
        result,
      });
    }

    await disableAutomaticSync();
    return NextResponse.json({ success: true, action: "disabled" });
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
        { success: false, message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while updating sync automation.",
      },
      { status: 500 },
    );
  }
}
