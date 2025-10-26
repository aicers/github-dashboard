import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import {
  removePersonalHoliday,
  updatePersonalHoliday,
} from "@/lib/user/time-settings";

import { personalHolidaySchema } from "../route";

const paramsSchema = z.object({
  id: z
    .string()
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "올바르지 않은 식별자입니다.",
    }),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const { id } = paramsSchema.parse(await context.params);
    const payload = personalHolidaySchema.parse(await request.json());
    const updated = await updatePersonalHoliday(session.userId, id, payload);
    return NextResponse.json({ success: true, result: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: error.issues[0]?.message ?? "잘못된 요청입니다.",
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

    console.error("Failed to update personal holiday", error);
    return NextResponse.json(
      {
        success: false,
        message: "개인 휴일을 수정하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const { id } = paramsSchema.parse(await context.params);
    await removePersonalHoliday(session.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: error.issues[0]?.message ?? "잘못된 요청입니다.",
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

    console.error("Failed to delete personal holiday", error);
    return NextResponse.json(
      {
        success: false,
        message: "개인 휴일을 삭제하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
