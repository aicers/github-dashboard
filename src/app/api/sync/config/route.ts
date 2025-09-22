import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchSyncStatus, updateSyncSettings } from "@/lib/sync/service";

const patchSchema = z.object({
  orgName: z.string().optional(),
  syncIntervalMinutes: z.number().int().positive().optional(),
});

export async function GET() {
  try {
    const status = await fetchSyncStatus();
    return NextResponse.json({ success: true, status });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while fetching sync configuration.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = patchSchema.parse(await request.json());
    await updateSyncSettings(payload);
    const status = await fetchSyncStatus();

    return NextResponse.json({ success: true, status });
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
        message: "Unexpected error while updating sync configuration.",
      },
      { status: 500 },
    );
  }
}
