import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { disableAutomaticSync, enableAutomaticSync } from "@/lib/sync/service";

const requestSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().positive().optional(),
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
