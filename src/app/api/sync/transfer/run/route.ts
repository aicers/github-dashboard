import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import { runTransferSync } from "@/lib/transfer/service";

export const POST = adminRoute(async (_request, session) => {
  try {
    const result = await runTransferSync({
      trigger: "manual",
      actorId: session.userId ?? null,
    });

    return NextResponse.json({
      success: true,
      message: "Transfer sync completed successfully.",
      result,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected error while running transfer sync.",
      },
      { status: 500 },
    );
  }
});
