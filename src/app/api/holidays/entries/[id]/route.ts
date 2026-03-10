import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute } from "@/lib/api/route-handler";
import { deleteHoliday, updateHoliday } from "@/lib/holidays/service";

const patchSchema = z.object({
  calendarCode: z.string().min(1, "달력을 선택해 주세요."),
  holidayDate: z.string().min(1, "날짜를 입력해 주세요."),
  weekday: z.string().optional(),
  name: z.string().min(1, "공휴일 이름을 입력해 주세요."),
  note: z.string().optional(),
});

async function resolveHolidayId(context: {
  params: Promise<{ id: string }>;
}): Promise<number> {
  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const normalized = decodeURIComponent(rawId.trim());
  const id = Number.parseInt(normalized, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("잘못된 공휴일 ID입니다.");
  }
  return id;
}

export const PATCH = adminRoute<{ id: string }>(
  async (request, _session, context) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "잘못된 요청 형식입니다." },
        { status: 400 },
      );
    }

    try {
      const id = await resolveHolidayId(context);
      const parsed = patchSchema.parse(payload);
      const holiday = await updateHoliday({
        id,
        calendarCode: parsed.calendarCode,
        holidayDate: parsed.holidayDate,
        weekday: parsed.weekday ?? null,
        name: parsed.name,
        note: parsed.note ?? null,
      });
      return NextResponse.json({ success: true, holiday });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            success: false,
            message: "요청 값을 확인해 주세요.",
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
        { success: false, message: "공휴일을 업데이트하지 못했습니다." },
        { status: 500 },
      );
    }
  },
);

export const DELETE = adminRoute<{ id: string }>(
  async (_request, _session, context) => {
    try {
      const id = await resolveHolidayId(context);
      await deleteHoliday(id);
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { success: false, message: "공휴일을 삭제하지 못했습니다." },
        { status: 500 },
      );
    }
  },
);
