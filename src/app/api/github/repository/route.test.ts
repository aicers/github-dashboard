// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { readActiveSession } from "@/lib/auth/session";
import type { SessionRecord } from "@/lib/auth/session-store";
import type { RepositorySummary } from "@/lib/github";
import { fetchRepositorySummary } from "@/lib/github";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  fetchRepositorySummary: vi.fn(),
}));

const readActiveSessionMock = vi.mocked(readActiveSession);
const fetchRepositorySummaryMock = vi.mocked(fetchRepositorySummary);

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

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/github/repository", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/github/repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readActiveSessionMock.mockResolvedValue(buildSession());
  });

  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/github/repository", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(fetchRepositorySummaryMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid payloads", async () => {
    const { POST } = await import("./route");
    const response = await POST(buildRequest({ owner: "", name: "" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      message: "Invalid request payload.",
    });
    expect(fetchRepositorySummaryMock).not.toHaveBeenCalled();
  });

  it("returns the repository summary when the lookup succeeds", async () => {
    const summary: RepositorySummary = {
      name: "next.js",
      description: "The React Framework",
      url: "https://github.com/vercel/next.js",
      stars: 1,
      forks: 2,
      openIssues: 3,
      openPullRequests: 4,
      defaultBranch: "canary",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    fetchRepositorySummaryMock.mockResolvedValueOnce(summary);

    const { POST } = await import("./route");
    const response = await POST(
      buildRequest({ owner: "vercel", name: "next.js" }),
    );

    expect(response.status).toBe(200);
    expect(fetchRepositorySummaryMock).toHaveBeenCalledWith(
      "vercel",
      "next.js",
    );
    expect(await response.json()).toEqual({
      success: true,
      repository: summary,
    });
  });

  it("returns 400 when the GitHub lookup fails", async () => {
    fetchRepositorySummaryMock.mockRejectedValueOnce(
      new Error("Repository vercel/next.js was not found."),
    );

    const { POST } = await import("./route");
    const response = await POST(
      buildRequest({ owner: "vercel", name: "next.js" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Repository vercel/next.js was not found.",
    });
  });
});
