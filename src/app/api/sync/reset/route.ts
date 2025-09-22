import { NextResponse } from "next/server";
import { z } from "zod";

import { resetData } from "@/lib/sync/service";

const requestSchema = z
  .object({
    preserveLogs: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json().catch(() => undefined));
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
