import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/sync/status/route";
import { readActiveSession } from "@/lib/auth/session";
import { fetchSyncStatus } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  fetchSyncStatus: vi.fn(),
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
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(),
  });
});

describe("GET /api/sync/status", () => {
  it("returns sync status details", async () => {
    const status = { config: { org_name: "acme" }, logs: [] };
    vi.mocked(fetchSyncStatus).mockResolvedValueOnce(status as never);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status });
    expect(fetchSyncStatus).toHaveBeenCalledTimes(1);
  });

  it("returns an error response when fetching status fails", async () => {
    vi.mocked(fetchSyncStatus).mockRejectedValueOnce(
      new Error("Status failure"),
    );

    const response = await GET();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Status failure",
    });
  });

  it("returns 500 when an unknown value is thrown", async () => {
    vi.mocked(fetchSyncStatus).mockRejectedValueOnce("bad");

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error while fetching sync status.",
    });
  });
});
