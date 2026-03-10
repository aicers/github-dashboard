import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import { runUnansweredMentionClassification } from "@/lib/dashboard/unanswered-mention-classifier";

export const POST = adminRoute(async (request, _session) => {
  try {
    let force = false;
    try {
      const payload = await request.json();
      if (payload && typeof payload === "object" && "force" in payload) {
        force = Boolean((payload as { force?: unknown }).force);
      }
    } catch {
      force = false;
    }

    const logger = ({
      level,
      message,
      meta,
    }: {
      level: "info" | "warn" | "error";
      message: string;
      meta?: Record<string, unknown>;
    }) => {
      const details = meta
        ? { ...meta, trigger: "manual" }
        : { trigger: "manual" };
      if (level === "error") {
        console.error(
          "[unanswered-mentions/manual] Classification error",
          message,
          details,
        );
      } else if (level === "warn") {
        console.warn(
          "[unanswered-mentions/manual] Classification warning",
          message,
          details,
        );
      } else {
        console.info(
          "[unanswered-mentions/manual] Classification info",
          message,
          details,
        );
      }
    };

    const summary = await runUnansweredMentionClassification({
      ...(force ? { force: true } : {}),
      logger,
    });

    console.info("[unanswered-mentions/manual] Classification summary", {
      trigger: "manual",
      ...summary,
    });
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
});
