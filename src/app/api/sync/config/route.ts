import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { DATE_TIME_FORMAT_VALUES } from "@/lib/date-time-format";
import { fetchSyncStatus, updateSyncSettings } from "@/lib/sync/service";

const patchSchema = z.object({
  orgName: z.string().optional(),
  syncIntervalMinutes: z.number().int().positive().optional(),
  timezone: z.string().min(1).optional(),
  weekStart: z.enum(["sunday", "monday"]).optional(),
  dateTimeFormat: z
    .string()
    .min(1)
    .refine(
      (value) =>
        DATE_TIME_FORMAT_VALUES.includes(
          value as (typeof DATE_TIME_FORMAT_VALUES)[number],
        ),
      { message: "Unsupported date-time display format." },
    )
    .optional(),
  excludedRepositories: z
    .array(z.string().min(1))
    .optional()
    .transform((value) => (value ? Array.from(new Set(value)) : undefined)),
  excludedPeople: z
    .array(z.string().min(1))
    .optional()
    .transform((value) => (value ? Array.from(new Set(value)) : undefined)),
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
    const status = await fetchSyncStatus();
    return NextResponse.json({ success: true, status });
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
        message: "Unexpected error while fetching sync configuration.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const payload = patchSchema.parse(await request.json());
    const {
      orgName,
      syncIntervalMinutes,
      excludedRepositories,
      excludedPeople,
      timezone,
      weekStart,
      dateTimeFormat,
    } = payload;

    if (!session.isAdmin) {
      const attemptedAdminUpdate =
        orgName !== undefined ||
        syncIntervalMinutes !== undefined ||
        excludedRepositories !== undefined ||
        excludedPeople !== undefined;

      if (attemptedAdminUpdate) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Administrator access is required to update organization controls.",
          },
          { status: 403 },
        );
      }

      await updateSyncSettings({ timezone, weekStart, dateTimeFormat });
    } else {
      await updateSyncSettings({
        orgName,
        syncIntervalMinutes,
        timezone,
        weekStart,
        excludedRepositories,
        excludedPeople,
        dateTimeFormat,
      });
    }

    const status = await fetchSyncStatus();

    return NextResponse.json({ success: true, status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request payload.",
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
      {
        success: false,
        message: "Unexpected error while updating sync configuration.",
      },
      { status: 500 },
    );
  }
}
