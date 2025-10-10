import { NextResponse } from "next/server";
import { z } from "zod";

import { activityFilterPayloadSchema } from "@/lib/activity/filter-schema";
import {
  deleteSavedFilter,
  updateSavedFilter,
} from "@/lib/activity/filter-store";
import type { ActivitySavedFilter } from "@/lib/activity/types";
import { readActiveSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const expectedSchema = z
  .object({
    updatedAt: z
      .union([z.string(), z.undefined(), z.null()])
      .transform((value) => (typeof value === "string" ? value : undefined))
      .optional(),
  })
  .optional();

const patchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Filter name is required.")
      .max(120, "Filter name must be 120 characters or fewer.")
      .optional(),
    payload: activityFilterPayloadSchema.optional(),
    expected: expectedSchema,
  })
  .refine(
    (value) => value.name !== undefined || value.payload !== undefined,
    "Missing update values.",
  );

const deleteSchema = z
  .object({
    expected: expectedSchema,
  })
  .partial()
  .optional();

function formatNotFoundResponse() {
  return NextResponse.json(
    {
      success: false,
      message: "저장된 필터를 찾을 수 없어요.",
    },
    { status: 404 },
  );
}

function formatConflictResponse(filter: ActivitySavedFilter) {
  return NextResponse.json(
    {
      success: false,
      message: "필터가 이미 변경되었어요. 최신 정보를 불러왔어요.",
      filter,
    },
    { status: 409 },
  );
}

export async function PATCH(request: Request, context: RouteParams) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  await ensureSchema();

  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const id = decodeURIComponent(rawId.trim());
  if (!id) {
    return NextResponse.json(
      { success: false, message: "Invalid filter id." },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const parsed = patchSchema.parse(payload);
    const result = await updateSavedFilter(session.userId, id, {
      name: parsed.name,
      payload: parsed.payload,
      expectedUpdatedAt: parsed.expected?.updatedAt ?? null,
    });

    if (result.status === "not_found") {
      return formatNotFoundResponse();
    }

    if (result.status === "conflict") {
      return formatConflictResponse(result.filter);
    }

    return NextResponse.json({ success: true, filter: result.filter });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "입력한 필터 정보를 확인해 주세요.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    console.error("Failed to update saved activity filter:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while updating filter.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: RouteParams) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  await ensureSchema();

  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const id = decodeURIComponent(rawId.trim());
  if (!id) {
    return NextResponse.json(
      { success: false, message: "Invalid filter id." },
      { status: 400 },
    );
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    // Ignore body parsing errors; treat as empty payload.
    rawBody = "";
  }

  let payload: unknown = {};
  if (rawBody.trim().length) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid request body." },
        { status: 400 },
      );
    }
  }

  try {
    const parsed = deleteSchema.parse(payload ?? {});
    const result = await deleteSavedFilter(session.userId, id, {
      expectedUpdatedAt: parsed?.expected?.updatedAt ?? null,
    });

    if (result.status === "not_found") {
      return formatNotFoundResponse();
    }

    if (result.status === "conflict") {
      return formatConflictResponse(result.filter);
    }

    return NextResponse.json({ success: true, filter: result.filter });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "입력한 필터 정보를 확인해 주세요.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    console.error("Failed to delete saved activity filter:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while deleting filter.",
      },
      { status: 500 },
    );
  }
}
