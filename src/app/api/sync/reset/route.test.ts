import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/reset/route";
import { readActiveSession } from "@/lib/auth/session";
import { resetData } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  resetData: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));
vi.mock("@/lib/auth/reauth-guard", () => ({
  checkReauthRequired: vi.fn(async () => false),
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

describe("POST /api/sync/reset", () => {
  it("resets data with default preserveLogs value", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(resetData).toHaveBeenCalledWith({ preserveLogs: true });
  });

  it("resets data with provided preserveLogs flag", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({ preserveLogs: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(resetData).toHaveBeenCalledWith({ preserveLogs: false });
  });

  it("returns a validation error response when payload is invalid", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({ preserveLogs: "nope" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(resetData).not.toHaveBeenCalled();
  });

  it("returns 400 when resetData throws a known error", async () => {
    vi.mocked(resetData).mockRejectedValueOnce(new Error("cannot truncate"));

    const response = await POST(
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "cannot truncate",
    });
  });

  it("returns 500 when resetData throws a non-error", async () => {
    vi.mocked(resetData).mockRejectedValueOnce("boom");

    const response = await POST(
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error while resetting data.",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await POST(
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(resetData).not.toHaveBeenCalled();
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
      new NextRequest("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required to manage sync operations.",
    });
    expect(resetData).not.toHaveBeenCalled();
  });
});
