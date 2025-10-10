import { NextResponse } from "next/server";
import { z } from "zod";

import { activityFilterPayloadSchema } from "@/lib/activity/filter-schema";
import {
  ActivitySavedFilterLimitError,
  createSavedFilter,
  listSavedFilters,
  SAVED_FILTER_LIMIT,
} from "@/lib/activity/filter-store";
import { readActiveSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Filter name is required.")
    .max(120, "Filter name must be 120 characters or fewer."),
  payload: activityFilterPayloadSchema,
});

export async function GET() {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  await ensureSchema();

  try {
    const filters = await listSavedFilters(session.userId);
    return NextResponse.json({
      success: true,
      filters,
      limit: SAVED_FILTER_LIMIT,
    });
  } catch (error) {
    console.error("Failed to list saved activity filters:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while loading saved filters.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  await ensureSchema();

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
    const { name, payload: filterPayload } = createSchema.parse(payload);
    const filter = await createSavedFilter(session.userId, name, filterPayload);
    return NextResponse.json(
      { success: true, filter, limit: SAVED_FILTER_LIMIT },
      { status: 201 },
    );
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

    if (error instanceof ActivitySavedFilterLimitError) {
      return NextResponse.json(
        {
          success: false,
          message: `필터는 최대 ${error.limit}개까지 저장할 수 있어요.`,
        },
        { status: 400 },
      );
    }

    console.error("Failed to create saved activity filter:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while saving filter.",
      },
      { status: 500 },
    );
  }
}
