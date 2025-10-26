import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import {
  addPersonalHoliday,
  readUserTimeSettings,
} from "@/lib/user/time-settings";

export const personalHolidaySchema = z.object({
  label: z
    .string()
    .optional()
    .transform((value) => (typeof value === "string" ? value.trim() : value))
    .transform((value) => (value === undefined || value === "" ? null : value)),
  startDate: z
    .string()
    .min(1, "시작일을 입력해 주세요.")
    .transform((value) => value.trim()),
  endDate: z
    .string()
    .optional()
    .transform((value) => (typeof value === "string" ? value.trim() : value))
    .transform((value) => (value === "" ? undefined : value)),
});

export async function GET() {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const settings = await readUserTimeSettings(session.userId);
    return NextResponse.json({
      success: true,
      result: settings.personalHolidays,
    });
  } catch (error) {
    console.error("Failed to load personal holidays", error);
    return NextResponse.json(
      {
        success: false,
        message: "개인 휴일 정보를 불러오지 못했습니다.",
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

  try {
    const payload = personalHolidaySchema.parse(await request.json());
    const created = await addPersonalHoliday(session.userId, payload);
    return NextResponse.json({ success: true, result: created });
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

    console.error("Failed to create personal holiday", error);
    return NextResponse.json(
      {
        success: false,
        message: "개인 휴일을 추가하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export type PersonalHolidayPayload = z.infer<typeof personalHolidaySchema>;
