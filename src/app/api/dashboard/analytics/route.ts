import { NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";

const querySchema = z.object({
  start: z.string(),
  end: z.string(),
  repos: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
    ),
  person: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.parse({
      start: searchParams.get("start"),
      end: searchParams.get("end"),
      repos: searchParams.get("repos"),
      person: searchParams.get("person"),
    });

    const analytics = await getDashboardAnalytics({
      start: parsed.start,
      end: parsed.end,
      repositoryIds: parsed.repos,
      personId: parsed.person ?? null,
    });

    return NextResponse.json({ success: true, analytics });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Invalid query parameters." },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while building dashboard analytics.",
      },
      { status: 500 },
    );
  }
}
