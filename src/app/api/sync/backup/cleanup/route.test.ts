// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

vi.mock("@/lib/auth/reauth-guard", () => ({
  checkReauthRequired: vi.fn(async () => false),
}));

vi.mock("@/lib/backup/service", () => ({
  cleanupDatabaseBackup: vi.fn(),
}));

const { readActiveSession } = vi.mocked(await import("@/lib/auth/session"));
const { cleanupDatabaseBackup } = vi.mocked(
  await import("@/lib/backup/service"),
);

async function loadHandler() {
  return await import("./route");
}

function createSession(
  overrides: Partial<Awaited<ReturnType<typeof readActiveSession>>> = {},
) {
  return {
    id: "session-id",
    userId: "admin-user",
    orgSlug: "org",
    orgVerified: true,
    isAdmin: true,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    refreshExpiresAt: new Date(Date.now() + 3600_000),
    maxExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    lastReauthAt: new Date(),
    deviceId: "device-1",
    ipCountry: "KR",
    ...overrides,
  };
}

function buildRequest() {
  return new NextRequest("http://localhost/api/sync/backup/cleanup", {
    method: "POST",
  });
}

describe("POST /api/sync/backup/cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    readActiveSession.mockResolvedValue(null);
    const { POST } = await loadHandler();

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(cleanupDatabaseBackup).not.toHaveBeenCalled();
  });

  it("requires administrator privileges", async () => {
    readActiveSession.mockResolvedValue(createSession({ isAdmin: false }));
    const { POST } = await loadHandler();

    const response = await POST(buildRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access required.",
    });
    expect(cleanupDatabaseBackup).not.toHaveBeenCalled();
  });

  it("calls cleanupDatabaseBackup and returns success payload", async () => {
    readActiveSession.mockResolvedValue(createSession());
    cleanupDatabaseBackup.mockResolvedValue({
      status: "running",
      completedAt: "2024-01-01T00:00:00.000Z",
      message: "cleanup",
    });
    const { POST } = await loadHandler();

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Database backup marked as failed and reset.",
      result: {
        status: "running",
        completedAt: "2024-01-01T00:00:00.000Z",
        message: "cleanup",
      },
    });
    expect(cleanupDatabaseBackup).toHaveBeenCalledWith({
      actorId: "admin-user",
    });
  });

  it("propagates service errors as 400 responses", async () => {
    readActiveSession.mockResolvedValue(createSession());
    cleanupDatabaseBackup.mockRejectedValue(new Error("cleanup failed"));
    const { POST } = await loadHandler();

    const response = await POST(buildRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "cleanup failed",
    });
  });

  it("returns 500 when service throws unknown error type", async () => {
    readActiveSession.mockResolvedValue(createSession());
    cleanupDatabaseBackup.mockRejectedValue("fatal");
    const { POST } = await loadHandler();

    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error while cleaning up database backup.",
    });
  });
});
