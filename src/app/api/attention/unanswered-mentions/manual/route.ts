import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import {
  buildMentionClassificationKey,
  fetchMentionClassifications,
  upsertMentionManualOverride,
} from "@/lib/dashboard/unanswered-mention-classifications";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";

const payloadSchema = z.object({
  commentId: z.string().min(1, "commentId is required."),
  mentionedUserId: z.string().min(1, "mentionedUserId is required."),
  state: z.enum(["suppress", "force", "clear"]),
  syncCompletedAt: z.string().datetime({ offset: true }).optional(),
});

type CommentRow = {
  body: string | null;
};

function computeCommentBodyHash(body: string | null): string {
  return createHash("sha256")
    .update(body ?? "", "utf8")
    .digest("hex");
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
          message: "Administrator access is required for this operation.",
        },
        { status: 403 },
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = payloadSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message:
            parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const { commentId, mentionedUserId, state, syncCompletedAt } = parsed.data;

    await ensureSchema();

    const commentResult = await query<CommentRow>(
      `SELECT COALESCE(data->>'body', '') AS body
         FROM comments
        WHERE id = $1`,
      [commentId],
    );

    if (!commentResult.rowCount) {
      return NextResponse.json(
        {
          success: false,
          message: "Comment not found for the provided identifier.",
        },
        { status: 404 },
      );
    }

    const commentBody = commentResult.rows[0]?.body ?? "";
    const commentBodyHash = computeCommentBodyHash(commentBody);
    const manualRequiresResponse = state === "clear" ? null : state === "force";
    const requiresResponseOverride =
      state === "clear" ? null : state === "force";
    const manualTimestamp = syncCompletedAt
      ? new Date(syncCompletedAt)
      : new Date();
    const manualAt = Number.isNaN(manualTimestamp.getTime())
      ? new Date()
      : manualTimestamp;

    await upsertMentionManualOverride({
      commentId,
      mentionedUserId,
      commentBodyHash,
      manualRequiresResponse,
      manualAt: state === "clear" ? null : manualAt,
      requiresResponse: requiresResponseOverride ?? undefined,
    });

    const classifications = await fetchMentionClassifications([
      { commentId, mentionedUserId },
    ]);
    const record =
      classifications.get(
        buildMentionClassificationKey(commentId, mentionedUserId),
      ) ?? null;

    const manualRequiresResponseAt = record?.manualRequiresResponseAt ?? null;
    const lastEvaluatedAt = record?.lastEvaluatedAt ?? null;
    let manualDecisionIsStale = false;
    if (manualRequiresResponseAt && lastEvaluatedAt) {
      const manualDate = new Date(manualRequiresResponseAt);
      const evaluatedDate = new Date(lastEvaluatedAt);
      if (
        !Number.isNaN(manualDate.getTime()) &&
        !Number.isNaN(evaluatedDate.getTime())
      ) {
        manualDecisionIsStale = manualDate.getTime() < evaluatedDate.getTime();
      }
    }

    return NextResponse.json({
      success: true,
      result: {
        commentId,
        mentionedUserId,
        manualRequiresResponse: record?.manualRequiresResponse ?? null,
        manualRequiresResponseAt,
        manualDecisionIsStale,
        requiresResponse: record?.requiresResponse ?? null,
        lastEvaluatedAt,
      },
    });
  } catch (error) {
    console.error(
      "[unanswered-mentions] Failed to update manual response requirement",
      error,
    );
    return NextResponse.json(
      {
        success: false,
        message: "Failed to update unanswered mention classification.",
      },
      { status: 500 },
    );
  }
}
