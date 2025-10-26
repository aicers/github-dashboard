import { NextResponse } from "next/server";

import { readActiveSession } from "@/lib/auth/session";
import { listHolidayCalendars } from "@/lib/holidays/service";

export async function GET() {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const calendars = await listHolidayCalendars();
    return NextResponse.json({ success: true, calendars });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, message: "공휴일 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
