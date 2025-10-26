import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { createHoliday, getCalendarHolidays } from "@/lib/holidays/service";

type RouteParams = {
  params: Promise<{ code: string }>;
};

const holidayPayloadSchema = z.object({
  holidayDate: z.string().min(1, "날짜는 필수입니다."),
  weekday: z.string().optional(),
  name: z.string().min(1, "공휴일 이름을 입력해 주세요."),
  note: z.string().optional(),
});

async function resolveCalendarCode(context: RouteParams) {
  const resolvedParams = await context.params;
  const rawCode = resolvedParams?.code ?? "";
  const code = decodeURIComponent(rawCode.trim());
  if (!code) {
    throw new Error("잘못된 공휴일 달력 코드입니다.");
  }
  return code;
}

export async function GET(_request: Request, context: RouteParams) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const code = await resolveCalendarCode(context);
    const holidays = await getCalendarHolidays(code);
    return NextResponse.json({ success: true, holidays });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, message: "공휴일 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteParams) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  if (!session.isAdmin) {
    return NextResponse.json(
      { success: false, message: "관리자만 공휴일을 수정할 수 있습니다." },
      { status: 403 },
    );
  }

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
    const code = await resolveCalendarCode(context);
    const parsed = holidayPayloadSchema.parse(payload);
    const holiday = await createHoliday({
      calendarCode: code,
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
      { success: false, message: "공휴일을 추가하지 못했습니다." },
      { status: 500 },
    );
  }
}
