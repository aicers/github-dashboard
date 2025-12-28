import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/activity/[id]/resync/route";
import { resyncActivityItem } from "@/lib/activity/item-resync";
import { readActiveSession } from "@/lib/auth/session";
import type { SessionRecord } from "@/lib/auth/session-store";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

vi.mock("@/lib/activity/item-resync", () => ({
  resyncActivityItem: vi.fn(),
}));

const readActiveSessionMock = vi.mocked(readActiveSession);
const resyncActivityItemMock = vi.mocked(resyncActivityItem);

function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const base = {
    id: "session-1",
    userId: "user-1",
    orgSlug: "acme",
    orgVerified: true,
    isAdmin: false,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2024-01-01T01:00:00.000Z"),
    expiresAt: new Date("2024-01-01T12:00:00.000Z"),
    refreshExpiresAt: new Date("2024-01-02T00:00:00.000Z"),
    maxExpiresAt: new Date("2024-02-01T00:00:00.000Z"),
    lastReauthAt: new Date("2024-01-01T00:00:00.000Z"),
    deviceId: "device-1",
    ipCountry: "KR",
  };
  return { ...base, ...overrides };
}

function buildRequest(id: string) {
  return new Request(`http://localhost/api/activity/${id}/resync`, {
    method: "POST",
  });
}

describe("POST /api/activity/[id]/resync", () => {
  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);

    const response = await POST(buildRequest("abc"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication required.",
    });
  });

  it("rejects invalid ids", async () => {
    readActiveSessionMock.mockResolvedValueOnce(buildSession());

    const response = await POST(buildRequest("%20"), {
      params: Promise.resolve({ id: "   " }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid activity id.",
    });
    expect(resyncActivityItemMock).not.toHaveBeenCalled();
  });

  it("invokes resync and returns the summary on success", async () => {
    readActiveSessionMock.mockResolvedValueOnce(buildSession());
    resyncActivityItemMock.mockResolvedValueOnce({
      nodeId: "abc",
      type: "issue",
    });

    const response = await POST(buildRequest("Issue%2D1"), {
      params: Promise.resolve({ id: "Issue%2D1" }),
    });

    expect(resyncActivityItemMock).toHaveBeenCalledWith("Issue-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      summary: { nodeId: "abc", type: "issue" },
    });
  });

  it("returns 404 for known not-found errors", async () => {
    readActiveSessionMock.mockResolvedValueOnce(buildSession());
    resyncActivityItemMock.mockRejectedValueOnce(
      new Error("Node not found in GitHub."),
    );

    const response = await POST(buildRequest("missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Node not found in GitHub.",
    });
  });

  it("returns 500 and propagates other errors", async () => {
    readActiveSessionMock.mockResolvedValueOnce(buildSession());
    resyncActivityItemMock.mockRejectedValueOnce(
      new Error("Failed to load item data from GitHub."),
    );

    const response = await POST(buildRequest("issue-1"), {
      params: Promise.resolve({ id: "issue-1" }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to load item data from GitHub.",
    });
  });
});
