import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/pr-link-backfill/route";
import { readActiveSession } from "@/lib/auth/session";
import { runPrLinkBackfill } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  runPrLinkBackfill: vi.fn(),
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
    expiresAt: new Date(Date.now() + 60_000),
    refreshExpiresAt: new Date(Date.now() + 60_000),
    maxExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    lastReauthAt: new Date(),
    deviceId: "device-1",
    ipCountry: "KR",
  });
});

describe("POST /api/sync/pr-link-backfill", () => {
  it("runs PR link backfill and returns the result", async () => {
    const report = {
      startDate: "2024-04-01T00:00:00.000Z",
      startedAt: "2024-05-01T12:00:00.000Z",
      completedAt: "2024-05-01T12:01:00.000Z",
      repositoriesProcessed: 2,
      pullRequestCount: 5,
      latestPullRequestUpdated: "2024-04-15T00:00:00.000Z",
    };
    vi.mocked(runPrLinkBackfill).mockResolvedValueOnce(report as never);

    const response = await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, result: report });
    expect(runPrLinkBackfill).toHaveBeenCalledWith(
      "2024-04-01",
      undefined,
      expect.any(Function),
    );
  });

  it("passes an end date when provided", async () => {
    vi.mocked(runPrLinkBackfill).mockResolvedValueOnce({} as never);

    await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({
          startDate: "2024-04-01",
          endDate: "2024-04-05",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(runPrLinkBackfill).toHaveBeenCalledWith(
      "2024-04-01",
      "2024-04-05",
      expect.any(Function),
    );
  });

  it("returns validation errors for invalid payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(runPrLinkBackfill).not.toHaveBeenCalled();
  });

  it("returns 400 if runPrLinkBackfill throws a known error", async () => {
    vi.mocked(runPrLinkBackfill).mockRejectedValueOnce(
      new Error("Backfill failure"),
    );

    const response = await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ success: false, message: "Backfill failure" });
  });

  it("returns 500 if runPrLinkBackfill throws a non-error value", async () => {
    vi.mocked(runPrLinkBackfill).mockRejectedValueOnce("boom");

    const response = await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: "Unexpected error during PR link backfill.",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(runPrLinkBackfill).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not an administrator", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce({
      id: "session",
      userId: "user",
      orgSlug: "org",
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

    const response = await POST(
      new Request("http://localhost/api/sync/pr-link-backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required to manage sync operations.",
    });
    expect(runPrLinkBackfill).not.toHaveBeenCalled();
  });
});
