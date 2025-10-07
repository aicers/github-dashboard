import { describe, expect, it } from "vitest";

import {
  buildHolidaySet,
  calculateBusinessDaysBetween,
  calculateBusinessHoursBetween,
  differenceInBusinessDays,
  differenceInBusinessDaysOrNull,
  normalizeHolidayDate,
} from "@/lib/dashboard/business-days";

describe("business-days utilities", () => {
  it("normalizes holiday inputs and builds a unique set", () => {
    expect(normalizeHolidayDate("2024-05-01")).toBe("2024-05-01");
    expect(normalizeHolidayDate("May 1, 2024 UTC")).toBe("2024-05-01");
    expect(normalizeHolidayDate(" ")).toBeNull();
    expect(normalizeHolidayDate("not-a-date")).toBeNull();

    const holidays = buildHolidaySet([
      "2024-05-01",
      "2024-05-01",
      "May 2, 2024 UTC",
      "invalid",
    ]);

    expect(Array.from(holidays)).toEqual(["2024-05-01", "2024-05-02"]);
  });

  it("calculates business hours while skipping weekends and holidays", () => {
    const holidays = buildHolidaySet(["2024-05-01"]);
    const start = "2024-04-29T00:00:00.000Z"; // Monday
    const end = "2024-05-03T00:00:00.000Z"; // Friday

    const hours = calculateBusinessHoursBetween(start, end, holidays);
    // Monday, Tuesday, and Thursday are counted (Wednesday is a holiday).
    expect(hours).toBe(72);

    const weekendOnly = calculateBusinessHoursBetween(
      "2024-05-04T00:00:00.000Z", // Saturday
      "2024-05-06T12:00:00.000Z", // Monday afternoon
      holidays,
    );
    expect(weekendOnly).toBe(12);

    expect(calculateBusinessHoursBetween(null, end, holidays)).toBeNull();
    expect(calculateBusinessHoursBetween(start, null, holidays)).toBeNull();
    expect(calculateBusinessHoursBetween(end, start, holidays)).toBe(0);
  });

  it("derives business day differences with and without null handling", () => {
    const holidays = buildHolidaySet([]);
    const now = new Date("2024-05-06T00:00:00.000Z"); // Monday

    const fourBusinessDays = calculateBusinessDaysBetween(
      "2024-04-30T00:00:00.000Z",
      now,
      holidays,
    );
    expect(fourBusinessDays).toBe(4);

    expect(
      differenceInBusinessDays("2024-04-30T00:00:00.000Z", now, holidays),
    ).toBe(4);
    expect(
      differenceInBusinessDaysOrNull("2024-04-30T00:00:00.000Z", now, holidays),
    ).toBe(4);
    expect(differenceInBusinessDaysOrNull(null, now, holidays)).toBeNull();
  });

  it("handles DST boundary weekends without leaking extra hours", () => {
    const holidays = buildHolidaySet([]);
    const dstStartHours = calculateBusinessHoursBetween(
      "2024-03-08T15:00:00.000Z", // Friday
      "2024-03-11T18:00:00.000Z", // Monday after the spring forward weekend
      holidays,
    );
    expect(dstStartHours).toBe(27);

    const dstEndHours = calculateBusinessHoursBetween(
      "2024-11-01T15:00:00.000Z", // Friday before the fall back weekend
      "2024-11-04T18:00:00.000Z", // Monday after the weekend
      holidays,
    );
    expect(dstEndHours).toBe(27);
  });

  it("normalizes common holiday variants including slash formatted dates", () => {
    expect(normalizeHolidayDate("2024/05/01 UTC")).toBe("2024-05-01");
    expect(normalizeHolidayDate("05/02/2024 UTC")).toBe("2024-05-02");
    expect(normalizeHolidayDate("May 03 2024 UTC")).toBe("2024-05-03");
    expect(normalizeHolidayDate("")).toBeNull();
  });
});
