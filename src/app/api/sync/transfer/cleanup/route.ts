import { NextResponse } from "next/server";

import { readActiveSession } from "@/lib/auth/session";
import { cleanupTransferSync } from "@/lib/transfer/service";

export async function POST() {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  if (!session.isAdmin) {
    return NextResponse.json(
      { success: false, message: "Administrator access required." },
      { status: 403 },
    );
  }

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
}
