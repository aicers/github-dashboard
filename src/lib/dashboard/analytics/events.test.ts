import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTotalEvents, fetchTrend } from "@/lib/dashboard/analytics/events";
import type { TrendPoint } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

afterEach(() => {
  vi.resetAllMocks();
});

describe("analytics events helpers", () => {
  it("returns zero totals when the database query has no rows", async () => {
    mockQuery.mockResolvedValue({
      rows: [],
      command: "",
      rowCount: 0,
      oid: 0,
      fields: [],
    });

    const result = await fetchTotalEvents(
      "2024-01-01",
      "2024-01-31",
      undefined,
    );

    expect(result).toEqual({
      total_events: 0,
      issues: 0,
      pull_requests: 0,
      reviews: 0,
      comments: 0,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("passes repository filters through to the query parameters", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          total_events: 5,
          issues: 2,
          pull_requests: 1,
          reviews: 1,
          comments: 1,
        },
      ],
      command: "",
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    await fetchTotalEvents("start", "end", ["repo-123"]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["start", "end", ["repo-123"]]);
  });

  it("normalizes trend rows into TrendPoint values", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { date: "2024-05-01", count: "5" },
        { date: new Date("2024-05-02T00:00:00.000Z"), count: 3 },
      ],
      command: "",
      rowCount: 2,
      oid: 0,
      fields: [],
    });

    const result = await fetchTrend(
      "issues",
      "github_created_at",
      "start",
      "end",
      undefined,
      "UTC",
    );

    const expected: TrendPoint[] = [
      { date: "2024-05-01", value: 5 },
      { date: "2024-05-02", value: 3 },
    ];
    expect(result).toEqual(expected);
  });
});
