import { NextResponse } from "next/server";
import { z } from "zod";

import { readActiveSession } from "@/lib/auth/session";
import { DATE_TIME_FORMAT_VALUES } from "@/lib/date-time-format";
import { isHolidayCalendarCode } from "@/lib/holidays/constants";
import { fetchSyncStatus, updateSyncSettings } from "@/lib/sync/service";
import {
  readUserTimeSettings,
  writeUserTimeSettings,
} from "@/lib/user/time-settings";

const patchSchema = z.object({
  orgName: z.string().optional(),
  syncIntervalMinutes: z.number().int().positive().optional(),
  timezone: z.string().min(1).optional(),
  weekStart: z.enum(["sunday", "monday"]).optional(),
  backupHour: z.number().int().min(0).max(23).optional(),
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
  holidayCalendarCode: z
    .string()
    .optional()
    .transform((value) => (typeof value === "string" ? value.trim() : value))
    .refine(
      (value) =>
        value === undefined ||
        (value.length > 0 && isHolidayCalendarCode(value)),
      { message: "Unsupported holiday calendar." },
    ),
  holidayCalendarCodes: z
    .array(z.string())
    .optional()
    .transform((value) =>
      value
        ?.map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    )
    .refine(
      (value) =>
        value === undefined ||
        value.every((code) => isHolidayCalendarCode(code)),
      { message: "Unsupported holiday calendar." },
    ),
  organizationHolidayCalendarCodes: z
    .array(z.string())
    .optional()
    .transform((value) =>
      value
        ?.map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    )
    .refine(
      (value) =>
        value === undefined ||
        value.every((code) => isHolidayCalendarCode(code)),
      { message: "Unsupported holiday calendar." },
    ),
  excludedRepositories: z
    .array(z.string().min(1))
    .optional()
    .transform((value) => (value ? Array.from(new Set(value)) : undefined)),
  excludedPeople: z
    .array(z.string().min(1))
    .optional()
    .transform((value) => (value ? Array.from(new Set(value)) : undefined)),
  allowedTeams: z
    .array(z.string().min(1))
    .optional()
    .transform((value) => (value ? Array.from(new Set(value)) : undefined)),
  allowedUsers: z
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
      allowedTeams,
      allowedUsers,
      timezone,
      weekStart,
      dateTimeFormat,
      holidayCalendarCode,
      holidayCalendarCodes,
      organizationHolidayCalendarCodes,
      backupHour,
    } = payload;

    const hasPersonalUpdate =
      timezone !== undefined ||
      weekStart !== undefined ||
      dateTimeFormat !== undefined ||
      holidayCalendarCode !== undefined ||
      holidayCalendarCodes !== undefined;

    if (!session.isAdmin) {
      const attemptedAdminUpdate =
        orgName !== undefined ||
        syncIntervalMinutes !== undefined ||
        excludedRepositories !== undefined ||
        excludedPeople !== undefined ||
        allowedTeams !== undefined ||
        allowedUsers !== undefined ||
        backupHour !== undefined ||
        organizationHolidayCalendarCodes !== undefined;

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

      if (hasPersonalUpdate) {
        if (!session.userId) {
          return NextResponse.json(
            {
              success: false,
              message:
                "User session is required to update personal time settings.",
            },
            { status: 400 },
          );
        }

        await writeUserTimeSettings(session.userId, {
          timezone,
          weekStart,
          dateTimeFormat,
          holidayCalendarCode,
          holidayCalendarCodes,
        });
      }
    } else {
      if (hasPersonalUpdate && session.userId) {
        await writeUserTimeSettings(session.userId, {
          timezone,
          weekStart,
          dateTimeFormat,
          holidayCalendarCode,
          holidayCalendarCodes,
        });
      }

      let backupScheduleTimezone: string | undefined;
      if (
        (backupHour !== undefined || timezone !== undefined) &&
        session.userId
      ) {
        const userSettings = await readUserTimeSettings(session.userId);
        backupScheduleTimezone = userSettings.timezone;
      } else if (backupHour !== undefined && typeof timezone === "string") {
        backupScheduleTimezone = timezone;
      }

      await updateSyncSettings({
        orgName,
        syncIntervalMinutes,
        excludedRepositories,
        excludedPeople,
        allowedTeams,
        allowedUsers,
        orgHolidayCalendarCodes: organizationHolidayCalendarCodes,
        backupHourLocal: backupHour,
        backupTimezone: backupScheduleTimezone,
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
