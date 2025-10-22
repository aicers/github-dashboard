import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureIssueStatusAutomation,
  getIssueStatusAutomationSummary,
  type IssueStatusAutomationRunResult,
  type IssueStatusAutomationSummary,
} from "@/lib/activity/status-automation";
import { readActiveSession } from "@/lib/auth/session";

const requestSchema = z
  .object({
    trigger: z.string().trim().min(1).max(120).optional(),
    force: z.boolean().optional(),
  })
  .optional();

type AutomationResponse = {
  run: IssueStatusAutomationRunResult;
  summary: IssueStatusAutomationSummary | null;
};

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
            "Administrator access is required to run issue status automation.",
        },
        { status: 403 },
      );
    }

    const payload = requestSchema.parse(
      await request.json().catch(() => undefined),
    );

    const runResult = await ensureIssueStatusAutomation({
      runId: null,
      trigger: payload?.trigger ?? "manual",
      force: payload?.force ?? true,
    });
    const summary = await getIssueStatusAutomationSummary();

    return NextResponse.json({
      success: true,
      result: {
        run: runResult,
        summary,
      } satisfies AutomationResponse,
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
      console.error("[status-automation] Manual trigger failed", error);
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    console.error(
      "[status-automation] Manual trigger failed with unknown error",
      error,
    );
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while running issue status automation.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
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
            "Administrator access is required to view issue status automation.",
        },
        { status: 403 },
      );
    }

    const summary = await getIssueStatusAutomationSummary();
    return NextResponse.json({
      success: true,
      summary,
      result: summary,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        "[status-automation] Failed to load automation summary",
        error,
      );
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 },
      );
    }

    console.error(
      "[status-automation] Failed to load automation summary",
      error,
    );
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while loading automation summary.",
      },
      { status: 500 },
    );
  }
}
