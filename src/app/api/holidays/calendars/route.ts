import { NextResponse } from "next/server";

import { authenticatedRoute } from "@/lib/api/route-handler";
import { listHolidayCalendars } from "@/lib/holidays/service";

export const GET = authenticatedRoute(async () => {
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
});
