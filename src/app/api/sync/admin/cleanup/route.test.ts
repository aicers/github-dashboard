import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/admin/cleanup/route";
import { readActiveSession } from "@/lib/auth/session";
import { cleanupStuckSyncRuns } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  cleanupStuckSyncRuns: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));
vi.mock("@/lib/auth/reauth-guard", () => ({
  checkReauthRequired: vi.fn(async () => false),
}));

const buildRequest = () =>
  new NextRequest("http://localhost/api/sync/admin/cleanup", {
    method: "POST",
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readActiveSession).mockResolvedValue({
    id: "session",
    userId: "admin-user",
    orgSlug: "acme",
    orgVerified: true,
    isAdmin: true,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    refreshExpiresAt: new Date(Date.now() + 60_000),
    maxExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    lastReauthAt: new Date(),
    deviceId: "device-1",
    ipCountry: "KR",
  });
});

describe("POST /api/sync/admin/cleanup", () => {
  it("returns cleanup results for administrators", async () => {
    vi.mocked(cleanupStuckSyncRuns).mockResolvedValueOnce({
      runCount: 2,
      logCount: 5,
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      result: { runCount: 2, logCount: 5 },
    });
    expect(cleanupStuckSyncRuns).toHaveBeenCalledWith({
      actorId: "admin-user",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(cleanupStuckSyncRuns).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks administrator access", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce({
      id: "session",
      userId: "user",
      orgSlug: "acme",
      orgVerified: true,
      isAdmin: false,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      refreshExpiresAt: new Date(Date.now() + 60_000),
      maxExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      lastReauthAt: new Date(),
      deviceId: "device-1",
      ipCountry: "KR",
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required to manage sync operations.",
    });
    expect(cleanupStuckSyncRuns).not.toHaveBeenCalled();
  });

  it("returns 400 when cleanup throws a known error", async () => {
    vi.mocked(cleanupStuckSyncRuns).mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    const response = await POST(buildRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "db unavailable",
    });
  });

  it("returns 500 when cleanup throws a non-error value", async () => {
    vi.mocked(cleanupStuckSyncRuns).mockRejectedValueOnce("boom");

    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error while cleaning up running syncs.",
    });
  });
});
