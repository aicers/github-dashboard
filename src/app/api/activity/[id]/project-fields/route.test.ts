// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem, ActivityItemDetail } from "@/lib/activity/types";
import { readActiveSession } from "@/lib/auth/session";
import type { SessionRecord } from "@/lib/auth/session-store";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

const getActivityItemDetailMock =
  vi.fn<(id: string) => Promise<ActivityItemDetail | null>>();
vi.mock("@/lib/activity/service", () => ({
  getActivityItemDetail: getActivityItemDetailMock,
}));

const applyProjectFieldOverridesMock =
  vi.fn<(issueId: string, updates: Record<string, unknown>) => Promise<void>>();
const clearProjectFieldOverridesMock =
  vi.fn<(issueId: string) => Promise<void>>();
vi.mock("@/lib/activity/project-field-store", () => ({
  applyProjectFieldOverrides: applyProjectFieldOverridesMock,
  clearProjectFieldOverrides: clearProjectFieldOverridesMock,
}));

const refreshActivityItemsSnapshotMock =
  vi.fn<
    (options?: { truncate?: boolean; ids?: readonly string[] }) => Promise<void>
  >();
vi.mock("@/lib/activity/snapshot", () => ({
  refreshActivityItemsSnapshot: refreshActivityItemsSnapshotMock,
}));

const readActiveSessionMock = vi.mocked(readActiveSession);

type RouteHandlers = typeof import("./route");

function createDetail(
  overrides: Partial<ActivityItem> = {},
): ActivityItemDetail {
  const baseItem: ActivityItem = {
    id: "issue-1",
    type: "issue",
    number: 101,
    title: "Test issue",
    url: "https://example.com/issue/101",
    state: "OPEN",
    status: "open",
    issueProjectStatus: "todo",
    issueProjectStatusSource: "activity",
    issueProjectStatusLocked: false,
    issueTodoProjectStatus: "todo",
    issueTodoProjectStatusAt: null,
    issueTodoProjectPriority: null,
    issueTodoProjectPriorityUpdatedAt: null,
    issueTodoProjectWeight: null,
    issueTodoProjectWeightUpdatedAt: null,
    issueTodoProjectInitiationOptions: null,
    issueTodoProjectInitiationOptionsUpdatedAt: null,
    issueTodoProjectStartDate: null,
    issueTodoProjectStartDateUpdatedAt: null,
    issueActivityStatus: "todo",
    issueActivityStatusAt: null,
    repository: null,
    author: null,
    assignees: [],
    reviewers: [],
    mentionedUsers: [],
    commenters: [],
    reactors: [],
    labels: [],
    issueType: null,
    milestone: null,
    linkedPullRequests: [],
    linkedIssues: [],
    hasParentIssue: false,
    hasSubIssues: false,
    createdAt: null,
    updatedAt: null,
    closedAt: null,
    mergedAt: null,
    businessDaysOpen: null,
    businessDaysIdle: null,
    businessDaysSinceInProgress: null,
    businessDaysInProgressOpen: null,
    attention: {
      unansweredMention: false,
      reviewRequestPending: false,
      reviewerUnassignedPr: false,
      reviewStalledPr: false,
      mergeDelayedPr: false,
      backlogIssue: false,
      stalledIssue: false,
    },
    ...overrides,
  };

  return {
    item: baseItem,
    body: null,
    bodyHtml: null,
    raw: {},
    parentIssues: [],
    subIssues: [],
    comments: [],
    commentCount: 0,
    linkedPullRequests: baseItem.linkedPullRequests,
    linkedIssues: baseItem.linkedIssues,
    reactions: [],
    todoStatusTimes: {},
    activityStatusTimes: {},
  };
}

function buildContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}

function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const base = {
    id: "session-1",
    userId: "user-1",
    orgSlug: "acme",
    orgVerified: true,
    isAdmin: true,
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

function buildRequest(
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(`http://localhost${path}`, init);
}

describe("PATCH /api/activity/[id]/project-fields", () => {
  let handlers: RouteHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    refreshActivityItemsSnapshotMock.mockResolvedValue(undefined);
    readActiveSessionMock.mockResolvedValue(buildSession());
    handlers = await import("./route");
  });

  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "P2" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(getActivityItemDetailMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not admin", async () => {
    readActiveSessionMock.mockResolvedValueOnce(
      buildSession({ isAdmin: false }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "P2" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required.",
    });
    expect(getActivityItemDetailMock).not.toHaveBeenCalled();
  });

  it("updates editable project fields and returns the refreshed item", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectPriority: "P1",
        issueTodoProjectWeight: "Medium",
        issueTodoProjectInitiationOptions: "Requires Approval",
        issueTodoProjectStartDate: "2024-05-01",
      }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectPriority: "P2",
        issueTodoProjectWeight: "Heavy",
        issueTodoProjectInitiationOptions: "Open to Start",
        issueTodoProjectStartDate: "2024-06-01",
      }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: "P2",
          weight: "Heavy",
          initiationOptions: "Open to Start",
          startDate: "2024-06-01",
        }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueTodoProjectPriority).toBe("P2");
    expect(body.item.issueTodoProjectWeight).toBe("Heavy");
    expect(body.item.issueTodoProjectInitiationOptions).toBe("Open to Start");
    expect(body.item.issueTodoProjectStartDate).toBe("2024-06-01");
    expect(applyProjectFieldOverridesMock).toHaveBeenCalledWith("issue-1", {
      priority: "P2",
      weight: "Heavy",
      initiationOptions: "Open to Start",
      startDate: "2024-06-01",
    });
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["issue-1"],
    });
  });

  it("rejects invalid priority values", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(createDetail());

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "invalid" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Priority 값이 올바르지 않아요.");
    expect(applyProjectFieldOverridesMock).not.toHaveBeenCalled();
  });

  it("rejects updates when to-do project locks non-weight fields", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueProjectStatusLocked: true,
        issueTodoProjectStatus: "done",
      }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "P1" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.todoStatus).toBe("done");
    expect(applyProjectFieldOverridesMock).not.toHaveBeenCalled();
  });

  it("detects expected value conflicts and returns the latest item", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectPriority: "P1",
      }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectPriority: "P0",
      }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: "P0",
          expected: {
            priority: {
              value: "P2",
            },
          },
        }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueTodoProjectPriority).toBe("P0");
    expect(applyProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the issue id is invalid", async () => {
    const response = await handlers.PATCH(
      buildRequest("/api/activity/%20/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "P1" }),
      }),
      buildContext(" "),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid issue id.");
    expect(applyProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue cannot be found", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(null);

    const response = await handlers.PATCH(
      buildRequest("/api/activity/missing/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "P1" }),
      }),
      buildContext("missing"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Issue not found.");
    expect(applyProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target detail is not an issue", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        type: "pull_request",
      }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/pr-1/project-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "P1" }),
      }),
      buildContext("pr-1"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Issue not found.");
    expect(applyProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/activity/[id]/project-fields", () => {
  let handlers: RouteHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    refreshActivityItemsSnapshotMock.mockResolvedValue(undefined);
    readActiveSessionMock.mockResolvedValue(buildSession());
    handlers = await import("./route");
  });

  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(clearProjectFieldOverridesMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not admin", async () => {
    readActiveSessionMock.mockResolvedValueOnce(
      buildSession({ isAdmin: false }),
    );

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required.",
    });
    expect(clearProjectFieldOverridesMock).not.toHaveBeenCalled();
  });

  it("clears overrides and returns the updated item when unlocked", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectStatus: "todo",
        issueTodoProjectPriority: "P1",
      }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectStatus: "todo",
        issueTodoProjectPriority: null,
      }),
    );

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueTodoProjectPriority).toBeNull();
    expect(clearProjectFieldOverridesMock).toHaveBeenCalledWith("issue-1");
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["issue-1"],
    });
  });

  it("returns conflict when to-do project locks the fields", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueTodoProjectStatus: "in_progress",
      }),
    );

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/project-fields", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.todoStatus).toBe("in_progress");
    expect(clearProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the issue id is invalid", async () => {
    const response = await handlers.DELETE(
      buildRequest("/api/activity/%20/project-fields", {
        method: "DELETE",
      }),
      buildContext(" "),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid issue id.");
    expect(clearProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue cannot be found", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(null);

    const response = await handlers.DELETE(
      buildRequest("/api/activity/missing/project-fields", {
        method: "DELETE",
      }),
      buildContext("missing"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Issue not found.");
    expect(clearProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });
});
