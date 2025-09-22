import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchRepositorySummary } from "@/lib/github";

const requestSchema = z.object({
  owner: z.string().min(1, "Owner is required."),
  name: z.string().min(1, "Repository name is required."),
});

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { owner, name } = requestSchema.parse(payload);
    const repository = await fetchRepositorySummary(owner, name);

    return NextResponse.json({ success: true, repository });
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
      { success: false, message: "Unexpected error while contacting GitHub." },
      { status: 500 },
    );
  }
}
