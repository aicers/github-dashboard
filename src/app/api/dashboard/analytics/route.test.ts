import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/dashboard/analytics/route";
import { readActiveSession } from "@/lib/auth/session";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";

vi.mock("@/lib/dashboard/analytics", () => ({
  getDashboardAnalytics: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readActiveSession).mockResolvedValue({
    id: "session",
    userId: "user",
    orgSlug: "org",
    orgVerified: true,
    isAdmin: true,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(),
  });
});

describe("GET /api/dashboard/analytics", () => {
  it("returns analytics data for valid queries", async () => {
    const analytics = { range: { start: "2024-01-01", end: "2024-01-07" } };
    vi.mocked(getDashboardAnalytics).mockResolvedValueOnce(analytics as never);

    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/analytics?start=2024-01-01&end=2024-01-07&repos=repo-1,repo-2",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, analytics });
    expect(getDashboardAnalytics).toHaveBeenCalledWith(
      {
        start: "2024-01-01",
        end: "2024-01-07",
        repositoryIds: ["repo-1", "repo-2"],
        personId: null,
      },
      { userId: "user" },
    );
  });

  it("returns validation errors for invalid queries", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/analytics?start=&end="),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(getDashboardAnalytics).not.toHaveBeenCalled();
  });

  it("returns 500 when analytics building fails unexpectedly", async () => {
    vi.mocked(getDashboardAnalytics).mockRejectedValueOnce(
      new Error("Failed to build analytics"),
    );

    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/analytics?start=2024-01-01&end=2024-01-07&repos=repo-1",
      ),
    );

    expect(getDashboardAnalytics).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: "Failed to build analytics",
    });
  });

  it("returns the default error response when a non-error value is thrown", async () => {
    vi.mocked(getDashboardAnalytics).mockRejectedValueOnce("boom");

    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/analytics?start=2024-01-01&end=2024-01-07&repos=repo-1&person=user-1",
      ),
    );

    expect(getDashboardAnalytics).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      message: "Unexpected error while building dashboard analytics.",
    });
  });

  it("returns 401 when no session is active", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/analytics?start=2024-01-01&end=2024-01-07",
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(getDashboardAnalytics).not.toHaveBeenCalled();
  });
});
