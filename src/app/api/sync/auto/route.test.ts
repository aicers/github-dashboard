import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/auto/route";
import { readActiveSession } from "@/lib/auth/session";
import { disableAutomaticSync, enableAutomaticSync } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  enableAutomaticSync: vi.fn(),
  disableAutomaticSync: vi.fn(),
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

describe("POST /api/sync/auto", () => {
  it("enables automatic sync with optional interval", async () => {
    const result = {
      since: null,
      until: null,
      startedAt: "2024-05-01T00:00:00.000Z",
      completedAt: "2024-05-01T00:10:00.000Z",
      summary: {
        repositoriesProcessed: 1,
        counts: {
          issues: 0,
          discussions: 0,
          pullRequests: 0,
          reviews: 0,
          comments: 0,
        },
        timestamps: {
          repositories: null,
          issues: null,
          discussions: null,
          pullRequests: null,
          reviews: null,
          comments: null,
        },
      },
    } satisfies Awaited<ReturnType<typeof enableAutomaticSync>>;
    vi.mocked(enableAutomaticSync).mockResolvedValueOnce(result);

    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 45 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      action: "enabled",
      result,
    });
    expect(enableAutomaticSync).toHaveBeenCalledWith({
      intervalMinutes: 45,
      logger: expect.any(Function),
    });
    expect(disableAutomaticSync).not.toHaveBeenCalled();
  });

  it("disables automatic sync when enabled is false", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, action: "disabled" });
    expect(disableAutomaticSync).toHaveBeenCalledTimes(1);
    expect(enableAutomaticSync).not.toHaveBeenCalled();
  });

  it("returns 400 when payload is invalid", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 0 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(enableAutomaticSync).not.toHaveBeenCalled();
    expect(disableAutomaticSync).not.toHaveBeenCalled();
  });

  it("returns 400 when enabling sync fails with a known error", async () => {
    vi.mocked(enableAutomaticSync).mockRejectedValueOnce(
      new Error("interval missing"),
    );

    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 30 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "interval missing",
    });
  });

  it("returns 500 when enabling sync throws a non-error value", async () => {
    vi.mocked(enableAutomaticSync).mockRejectedValueOnce("boom");

    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 30 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error while updating sync automation.",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 30 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(enableAutomaticSync).not.toHaveBeenCalled();
    expect(disableAutomaticSync).not.toHaveBeenCalled();
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
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 30 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required to manage sync operations.",
    });
    expect(enableAutomaticSync).not.toHaveBeenCalled();
    expect(disableAutomaticSync).not.toHaveBeenCalled();
  });
});
