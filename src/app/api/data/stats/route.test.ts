import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/data/stats/route";
import { fetchDashboardStats } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  fetchDashboardStats: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/data/stats", () => {
  it("returns dashboard stats", async () => {
    const stats = { issues: 10, pullRequests: 5 };
    vi.mocked(fetchDashboardStats).mockResolvedValueOnce(stats as never);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, stats });
    expect(fetchDashboardStats).toHaveBeenCalledTimes(1);
  });

  it("returns an error response when fetching stats fails", async () => {
    vi.mocked(fetchDashboardStats).mockRejectedValueOnce(
      new Error("Stats unavailable"),
    );

    const response = await GET();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Stats unavailable",
    });
  });
});
