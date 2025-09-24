import { describe, expect, test } from "vitest";

import { __analyticsInternals } from "@/components/dashboard/analytics-view";

describe("analytics-view helpers", () => {
  test("formatDuration renders hours and days appropriately", () => {
    expect(__analyticsInternals.formatDuration(12, "hours")).toBe("12시간");
    expect(__analyticsInternals.formatDuration(72, "hours")).toBe("3.0일");
    expect(__analyticsInternals.formatDuration(48, "days")).toBe("2.0일");
  });

  test("buildRangeFromPreset computes expected ranges", () => {
    const reference = new Date("2024-05-15T12:00:00Z");
    const last30 = __analyticsInternals.buildRangeFromPreset(
      "last_30_days",
      "UTC",
      reference,
    );
    expect(last30).not.toBeNull();
    const startIso = last30?.start ?? null;
    const endIso = last30?.end ?? null;
    if (startIso && endIso) {
      const start = new Date(startIso);
      const end = new Date(endIso);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(28.9);
      expect(diffDays).toBeLessThanOrEqual(30.1);
    }

    const thisMonth = __analyticsInternals.buildRangeFromPreset(
      "this_month",
      "UTC",
      reference,
    );
    expect(thisMonth).not.toBeNull();
    const monthStartIso = thisMonth?.start ?? null;
    const monthEndIso = thisMonth?.end ?? null;
    if (monthStartIso && monthEndIso) {
      const start = new Date(monthStartIso);
      const end = new Date(monthEndIso);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThanOrEqual(27);
      expect(diffDays).toBeLessThanOrEqual(31);
    }
  });

  test("mergeTrends combines series by date", () => {
    const merged = __analyticsInternals.mergeTrends(
      [
        { date: "2024-01-01", value: 3 },
        { date: "2024-01-02", value: 5 },
      ],
      [
        { date: "2024-01-02", value: 4 },
        { date: "2024-01-03", value: 2 },
      ],
      "left",
      "right",
    );

    expect(merged).toEqual([
      { date: "2024-01-01", left: 3, right: 0 },
      { date: "2024-01-02", left: 5, right: 4 },
      { date: "2024-01-03", left: 0, right: 2 },
    ]);
  });
});
