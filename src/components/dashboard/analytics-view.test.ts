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
    const last14 = __analyticsInternals.buildRangeFromPreset(
      "last_14_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last14).not.toBeNull();
    const startIso = last14?.start ?? null;
    const endIso = last14?.end ?? null;
    if (startIso && endIso) {
      const start = new Date(startIso);
      const end = new Date(endIso);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(13.9);
      expect(diffDays).toBeLessThanOrEqual(14.1);
    }

    const last30 = __analyticsInternals.buildRangeFromPreset(
      "last_30_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last30).not.toBeNull();
    const last30Start = last30?.start ?? null;
    const last30End = last30?.end ?? null;
    if (last30Start && last30End) {
      const start = new Date(last30Start);
      const end = new Date(last30End);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(28.9);
      expect(diffDays).toBeLessThanOrEqual(30.1);
    }

    const last60 = __analyticsInternals.buildRangeFromPreset(
      "last_60_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last60).not.toBeNull();
    const last60Start = last60?.start ?? null;
    const last60End = last60?.end ?? null;
    if (last60Start && last60End) {
      const start = new Date(last60Start);
      const end = new Date(last60End);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(58.9);
      expect(diffDays).toBeLessThanOrEqual(60.1);
    }

    const last90 = __analyticsInternals.buildRangeFromPreset(
      "last_90_days",
      "UTC",
      "monday",
      reference,
    );
    expect(last90).not.toBeNull();
    const last90Start = last90?.start ?? null;
    const last90End = last90?.end ?? null;
    if (last90Start && last90End) {
      const start = new Date(last90Start);
      const end = new Date(last90End);
      const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(88.9);
      expect(diffDays).toBeLessThanOrEqual(90.1);
    }

    const thisMonth = __analyticsInternals.buildRangeFromPreset(
      "this_month",
      "UTC",
      "monday",
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

    const mondayWeek = __analyticsInternals.buildRangeFromPreset(
      "this_week",
      "UTC",
      "monday",
      reference,
    );
    const sundayWeek = __analyticsInternals.buildRangeFromPreset(
      "this_week",
      "UTC",
      "sunday",
      reference,
    );
    expect(mondayWeek).not.toBeNull();
    expect(sundayWeek).not.toBeNull();
    if (mondayWeek && sundayWeek) {
      expect(mondayWeek.start).not.toEqual(sundayWeek.start);
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

  test("buildNetTrend computes issue net deltas across the selected range", () => {
    const { mergeTrends, buildNetTrend } = __analyticsInternals;
    const dateKeys = ["2024-01-01", "2024-01-02", "2024-01-03"];

    const issuesCreated = [
      { date: "2024-01-01", value: 5 },
      { date: "2024-01-02", value: 2 },
    ];
    const issuesClosed = [
      { date: "2024-01-01", value: 1 },
      { date: "2024-01-03", value: 4 },
    ];

    const merged = mergeTrends(
      issuesCreated,
      issuesClosed,
      "created",
      "closed",
    );
    const netTrend = buildNetTrend(dateKeys, merged, "created", "closed");

    expect(netTrend).toEqual([
      { date: "2024-01-01", delta: 4 },
      { date: "2024-01-02", delta: 2 },
      { date: "2024-01-03", delta: -4 },
    ]);
  });

  test("buildNetTrend normalizes PR deltas when data is missing or non-finite", () => {
    const { mergeTrends, buildNetTrend } = __analyticsInternals;
    const dateKeys = ["2024-02-10", "2024-02-11", "2024-02-12"];

    const prsCreated = [
      { date: "2024-02-10", value: 3 },
      { date: "2024-02-11T09:30:00Z", value: 4 },
    ];
    const prsMerged = [
      { date: "2024-02-10", value: 5 },
      { date: "2024-02-11", value: Number.NaN },
    ];

    const merged = mergeTrends(prsCreated, prsMerged, "created", "merged");
    const netTrend = buildNetTrend(dateKeys, merged, "created", "merged");

    expect(netTrend).toEqual([
      { date: "2024-02-10", delta: -2 },
      { date: "2024-02-11", delta: 4 },
      { date: "2024-02-12", delta: 0 },
    ]);
  });
});
