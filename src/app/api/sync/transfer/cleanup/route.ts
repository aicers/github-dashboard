import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/route-handler";
import { cleanupTransferSync } from "@/lib/transfer/service";

export const POST = adminRoute(async (_request, session) => {
  try {
    const result = await cleanupTransferSync({ actorId: session.userId });
    return NextResponse.json({
      success: true,
      message: "Transfer sync marked as failed and reset.",
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
        message: "Unexpected error while cleaning up transfer sync.",
      },
      { status: 500 },
    );
  }
});
