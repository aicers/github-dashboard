import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatDateTimeDisplay } from "@/lib/date-time-format";

describe("formatDateTimeDisplay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes non-breaking spaces in auto-formatted output", () => {
    vi.spyOn(DateTime.prototype, "toLocaleString").mockReturnValue(
      "Mar 9, 2026, 11:58\u202fPM",
    );

    expect(
      formatDateTimeDisplay("2026-03-09T14:58:00.000Z", {
        format: "auto",
        locale: "en-US",
        timeZone: "UTC",
      }),
    ).toBe("Mar 9, 2026, 11:58 PM");
  });
});
