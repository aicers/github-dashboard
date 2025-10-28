import { NextResponse } from "next/server";

import { readActiveSession } from "@/lib/auth/session";
import { runUnansweredMentionClassification } from "@/lib/dashboard/unanswered-mention-classifier";

export async function POST() {
  try {
    const session = await readActiveSession();
    if (!session) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required.",
        },
        { status: 401 },
      );
    }

    if (!session.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Administrator access is required to classify unanswered mentions.",
        },
        { status: 403 },
      );
    }

    const summary = await runUnansweredMentionClassification();
    return NextResponse.json({
      success: true,
      result: summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error during unanswered mention classification.",
      },
      { status: 500 },
    );
  }
}
