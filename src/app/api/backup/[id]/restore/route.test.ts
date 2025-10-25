// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

vi.mock("@/lib/backup/service", () => ({
  restoreDatabaseBackup: vi.fn(),
}));

const { readActiveSession } = vi.mocked(await import("@/lib/auth/session"));
const { restoreDatabaseBackup } = vi.mocked(
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
    userId: "user-1",
    orgSlug: "org",
    orgVerified: true,
    isAdmin: true,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

describe("POST /api/backup/[id]/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    readActiveSession.mockResolvedValue(null);
    const { POST } = await loadHandler();
    const response = await POST(
      new NextRequest("http://localhost/api/backup/1/restore", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ id: "1" }),
      },
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
  });

  it("requires administrator privileges", async () => {
    readActiveSession.mockResolvedValue(createSession({ isAdmin: false }));
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/2/restore", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ id: "2" }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access required.",
    });
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
  });

  it("rejects invalid backup identifiers", async () => {
    readActiveSession.mockResolvedValue(createSession());
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/not-number/restore", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ id: "not-a-number" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Invalid backup identifier.",
    });
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
  });

  it("restores backup and returns success payload", async () => {
    readActiveSession.mockResolvedValue(
      createSession({ userId: "admin-user" }),
    );
    restoreDatabaseBackup.mockResolvedValue(undefined);
    const { POST } = await loadHandler();

    const response = await POST(
      new NextRequest("http://localhost/api/backup/3/restore", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ id: "3" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(restoreDatabaseBackup).toHaveBeenCalledWith({
      backupId: 3,
      actorId: "admin-user",
    });
  });

  it("propagates service errors as 400 responses", async () => {
    readActiveSession.mockResolvedValue(createSession());
    restoreDatabaseBackup.mockRejectedValue(
      new Error("Backup record not found."),
    );

    const { POST } = await loadHandler();
    const response = await POST(
      new NextRequest("http://localhost/api/backup/5/restore", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ id: "5" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Backup record not found.",
    });
  });

  it("returns 500 when service throws unknown error type", async () => {
    readActiveSession.mockResolvedValue(createSession());
    restoreDatabaseBackup.mockRejectedValue("fatal");

    const { POST } = await loadHandler();
    const response = await POST(
      new NextRequest("http://localhost/api/backup/6/restore", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ id: "6" }),
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "Unexpected error during restore.",
    });
  });
});
