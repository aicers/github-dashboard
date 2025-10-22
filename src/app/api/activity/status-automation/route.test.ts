import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureIssueStatusAutomation,
  getIssueStatusAutomationSummary,
  type IssueStatusAutomationSummary,
} from "@/lib/activity/status-automation";
import { readActiveSession } from "@/lib/auth/session";

import { GET, POST } from "./route";

vi.mock("@/lib/activity/status-automation", () => ({
  ensureIssueStatusAutomation: vi.fn(),
  getIssueStatusAutomationSummary: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

const ADMIN_SESSION = {
  id: "session",
  userId: "user",
  orgSlug: "org",
  orgVerified: true,
  isAdmin: true,
  createdAt: new Date(),
  lastSeenAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readActiveSession).mockResolvedValue(ADMIN_SESSION);
});

describe("POST /api/activity/status-automation", () => {
  it("runs automation and returns the execution summary", async () => {
    const runResult = {
      processed: true,
      insertedInProgress: 3,
      insertedDone: 1,
      insertedCanceled: 0,
    };
    const summary = {
      cacheKey: "issue-status-automation",
      generatedAt: "2024-05-10T12:00:00.000Z",
      updatedAt: "2024-05-10T12:01:00.000Z",
      syncRunId: 42,
      runId: 42,
      status: "success",
      trigger: "sync-controls",
      lastSuccessfulSyncAt: "2024-05-10T11:55:00.000Z",
      lastSuccessAt: "2024-05-10T12:01:30.000Z",
      lastSuccessSyncAt: "2024-05-10T11:55:00.000Z",
      insertedInProgress: 3,
      insertedDone: 1,
      insertedCanceled: 0,
      itemCount: 4,
      error: null,
    } satisfies IssueStatusAutomationSummary;
    vi.mocked(ensureIssueStatusAutomation).mockResolvedValueOnce(runResult);
    vi.mocked(getIssueStatusAutomationSummary).mockResolvedValueOnce(summary);

    const response = await POST(
      new Request("http://localhost/api/activity/status-automation", {
        method: "POST",
        body: JSON.stringify({ trigger: "sync-controls" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      result: { run: runResult, summary },
    });
    expect(ensureIssueStatusAutomation).toHaveBeenCalledWith({
      runId: null,
      trigger: "sync-controls",
      force: true,
      overrideSyncAt: null,
    });
    expect(getIssueStatusAutomationSummary).toHaveBeenCalledTimes(1);
  });

  it("accepts a manual start timestamp", async () => {
    const runResult = {
      processed: true,
      insertedInProgress: 1,
      insertedDone: 0,
      insertedCanceled: 0,
    };
    const summary = {
      cacheKey: "issue-status-automation",
      generatedAt: "2024-05-10T12:00:00.000Z",
      updatedAt: "2024-05-10T12:01:00.000Z",
      syncRunId: 42,
      runId: 42,
      status: "success",
      trigger: "sync-controls",
      lastSuccessfulSyncAt: "2024-05-10T11:55:00.000Z",
      lastSuccessAt: "2024-05-10T12:01:30.000Z",
      lastSuccessSyncAt: "2024-05-10T11:55:00.000Z",
      insertedInProgress: 1,
      insertedDone: 0,
      insertedCanceled: 0,
      itemCount: 1,
      error: null,
    } satisfies IssueStatusAutomationSummary;
    vi.mocked(ensureIssueStatusAutomation).mockResolvedValueOnce(runResult);
    vi.mocked(getIssueStatusAutomationSummary).mockResolvedValueOnce(summary);

    const response = await POST(
      new Request("http://localhost/api/activity/status-automation", {
        method: "POST",
        body: JSON.stringify({
          trigger: "sync-controls",
          startAt: "2024-05-09T10:00:00",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(ensureIssueStatusAutomation).toHaveBeenCalledWith({
      runId: null,
      trigger: "sync-controls",
      force: true,
      overrideSyncAt: new Date("2024-05-09T10:00:00").toISOString(),
    });
  });

  it("returns 400 when payload validation fails", async () => {
    const response = await POST(
      new Request("http://localhost/api/activity/status-automation", {
        method: "POST",
        body: JSON.stringify({ force: "yes" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(ensureIssueStatusAutomation).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/activity/status-automation", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(ensureIssueStatusAutomation).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks admin rights", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce({
      ...ADMIN_SESSION,
      isAdmin: false,
    });

    const response = await POST(
      new Request("http://localhost/api/activity/status-automation", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message:
        "Administrator access is required to run issue status automation.",
    });
    expect(ensureIssueStatusAutomation).not.toHaveBeenCalled();
  });
});

describe("GET /api/activity/status-automation", () => {
  it("returns the latest automation summary", async () => {
    const summary = {
      cacheKey: "issue-status-automation",
      generatedAt: "2024-05-10T12:00:00.000Z",
      updatedAt: "2024-05-10T12:01:00.000Z",
      syncRunId: 42,
      runId: 42,
      status: "success",
      trigger: "manual",
      lastSuccessfulSyncAt: "2024-05-10T11:55:00.000Z",
      lastSuccessAt: "2024-05-10T12:01:30.000Z",
      lastSuccessSyncAt: "2024-05-10T11:55:00.000Z",
      insertedInProgress: 2,
      insertedDone: 1,
      insertedCanceled: 0,
      itemCount: 3,
      error: null,
    } satisfies IssueStatusAutomationSummary;
    vi.mocked(getIssueStatusAutomationSummary).mockResolvedValueOnce(summary);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      summary,
      result: summary,
    });
    expect(getIssueStatusAutomationSummary).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
  });

  it("returns 403 when the user lacks admin rights", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce({
      ...ADMIN_SESSION,
      isAdmin: false,
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message:
        "Administrator access is required to view issue status automation.",
    });
  });

  it("returns 500 when loading the summary fails", async () => {
    vi.mocked(getIssueStatusAutomationSummary).mockRejectedValueOnce(
      new Error("database offline"),
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      message: "database offline",
    });
  });
});
