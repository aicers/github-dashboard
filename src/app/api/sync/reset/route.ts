import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { resetData } from "@/lib/sync/service";

const requestSchema = z
  .object({
    preserveLogs: z.boolean().optional(),
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
            "Administrator access is required to manage sync operations.",
        },
        { status: 403 },
      );
    }

    const payload = requestSchema.parse(
      await request.json().catch(() => undefined),
    );
    await resetData({ preserveLogs: payload?.preserveLogs ?? true });

    return NextResponse.json({ success: true });
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
      { success: false, message: "Unexpected error while resetting data." },
      { status: 500 },
    );
  }
}
