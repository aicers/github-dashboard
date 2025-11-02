import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/backfill/route";
import { readActiveSession } from "@/lib/auth/session";
import { runBackfill } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  runBackfill: vi.fn(),
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
  });
});

describe("POST /api/sync/backfill", () => {
  it("runs a backfill and returns the result", async () => {
    const report = { startDate: "2024-04-01", chunkCount: 2 };
    vi.mocked(runBackfill).mockResolvedValueOnce(report as never);

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, result: report });
    expect(runBackfill).toHaveBeenCalledWith(
      "2024-04-01",
      null,
      expect.any(Function),
    );
  });

  it("passes the end date to the backfill runner when provided", async () => {
    const report = { startDate: "2024-04-01", chunkCount: 1 };
    vi.mocked(runBackfill).mockResolvedValueOnce(report as never);

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({
          startDate: "2024-04-01",
          endDate: "2024-04-10",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runBackfill).toHaveBeenCalledWith(
      "2024-04-01",
      "2024-04-10",
      expect.any(Function),
    );
  });

  it("runs a full-history backfill when no dates are provided", async () => {
    const report = { startDate: null, chunkCount: 1 };
    vi.mocked(runBackfill).mockResolvedValueOnce(report as never);

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      result: report,
    });
    expect(runBackfill).toHaveBeenCalledWith(null, null, expect.any(Function));
  });

  it("returns 400 if runBackfill throws a known error", async () => {
    vi.mocked(runBackfill).mockRejectedValueOnce(new Error("Backfill failure"));

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: "Backfill failure",
    });
  });

  it("returns 500 if runBackfill throws a non-error value", async () => {
    vi.mocked(runBackfill).mockRejectedValueOnce("boom");

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: "Unexpected error during backfill run.",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
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
    expect(runBackfill).not.toHaveBeenCalled();
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
    });

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
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
    expect(runBackfill).not.toHaveBeenCalled();
  });
});
