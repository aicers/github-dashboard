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
  runDatabaseBackup: vi.fn(),
}));

const { readActiveSession } = vi.mocked(await import("@/lib/auth/session"));
const { runDatabaseBackup } = vi.mocked(await import("@/lib/backup/service"));

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

describe("POST /api/backup/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    readActiveSession.mockResolvedValue(null);
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/run", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(runDatabaseBackup).not.toHaveBeenCalled();
  });

  it("requires administrator privileges", async () => {
    readActiveSession.mockResolvedValue(createSession({ isAdmin: false }));
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/run", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access required.",
    });
    expect(runDatabaseBackup).not.toHaveBeenCalled();
  });

  it("runs backup and returns success payload", async () => {
    readActiveSession.mockResolvedValue(createSession());
    runDatabaseBackup.mockResolvedValue(undefined);
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/run", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Backup completed successfully.",
    });
    expect(runDatabaseBackup).toHaveBeenCalledWith({
      trigger: "manual",
      actorId: "admin-user",
    });
  });

  it("propagates service errors as 400 responses", async () => {
    readActiveSession.mockResolvedValue(createSession());
    runDatabaseBackup.mockRejectedValue(new Error("Backup failed."));
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/run", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Backup failed.",
    });
  });

  it("returns 500 when service throws unknown error type", async () => {
    readActiveSession.mockResolvedValue(createSession());
    runDatabaseBackup.mockRejectedValue("fatal");
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/run", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error while running backup.",
    });
  });
});
