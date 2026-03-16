// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem, ActivityItemDetail } from "@/lib/activity/types";
import { readActiveSession } from "@/lib/auth/session";
import type { SessionRecord } from "@/lib/auth/session-store";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

const ensureSchemaMock = vi.fn();
vi.mock("@/lib/db", () => ({
  ensureSchema: ensureSchemaMock,
}));

const getActivityItemDetailMock =
  vi.fn<(id: string) => Promise<ActivityItemDetail | null>>();
vi.mock("@/lib/activity/service", () => ({
  getActivityItemDetail: getActivityItemDetailMock,
}));

const recordActivityStatusMock =
  vi.fn<
    (
      issueId: string,
      status: ActivityItem["issueProjectStatus"],
      occurredAt?: Date,
    ) => Promise<void>
  >();
const clearActivityStatusesMock = vi.fn<(issueId: string) => Promise<void>>();
vi.mock("@/lib/activity/status-store", () => ({
  recordActivityStatus: recordActivityStatusMock,
  clearActivityStatuses: clearActivityStatusesMock,
}));

const clearProjectFieldOverridesMock =
  vi.fn<(issueId: string) => Promise<void>>();
vi.mock("@/lib/activity/project-field-store", () => ({
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

describe("PATCH /api/activity/[id]/status", () => {
  let handlers: RouteHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    ensureSchemaMock.mockResolvedValue(undefined);
    refreshActivityItemsSnapshotMock.mockResolvedValue(undefined);
    readActiveSessionMock.mockResolvedValue(buildSession());
    handlers = await import("./route");
  });

  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
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
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
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

  it("updates the issue status and returns the refreshed item", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "todo" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "done" }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueProjectStatus).toBe("done");
    expect(recordActivityStatusMock).toHaveBeenCalledWith("issue-1", "done");
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
    expect(clearProjectFieldOverridesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["issue-1"],
    });
  });

  it("allows updating the issue status to canceled", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "todo" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "canceled" }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueProjectStatus).toBe("canceled");
    expect(recordActivityStatusMock).toHaveBeenCalledWith(
      "issue-1",
      "canceled",
    );
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["issue-1"],
    });
  });

  it("clears the issue status when requesting no_status", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "todo" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "no_status" }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "no_status" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueProjectStatus).toBe("no_status");
    expect(clearActivityStatusesMock).toHaveBeenCalledWith("issue-1");
    expect(recordActivityStatusMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["issue-1"],
    });
  });

  it("returns a conflict when the expected status does not match the current status", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "done" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "in_progress" }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "done",
          expectedStatus: "todo",
        }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueProjectStatus).toBe("in_progress");
    expect(recordActivityStatusMock).not.toHaveBeenCalled();
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns a conflict when the status is locked by the to-do project", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueProjectStatusLocked: true,
        issueTodoProjectStatus: "done",
      }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: string;
      todoStatus: ActivityItem["issueTodoProjectStatus"];
    };
    expect(body.todoStatus).toBe("done");
    expect(recordActivityStatusMock).not.toHaveBeenCalled();
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body cannot be parsed", async () => {
    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        body: "not-json",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid request body.");
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the status value is missing or invalid", async () => {
    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "invalid" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Missing or invalid status value.");
    expect(getActivityItemDetailMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the expected status value is invalid", async () => {
    const response = await handlers.PATCH(
      buildRequest("/api/activity/issue-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "todo", expectedStatus: "invalid" }),
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Missing or invalid expected status value.");
    expect(getActivityItemDetailMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue cannot be found", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(null);

    const response = await handlers.PATCH(
      buildRequest("/api/activity/missing/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "todo" }),
      }),
      buildContext("missing"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Issue not found.");
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target is not an issue", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        type: "pull_request",
      }),
    );

    const response = await handlers.PATCH(
      buildRequest("/api/activity/pr-1/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "todo" }),
      }),
      buildContext("pr-1"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Issue not found.");
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the issue id is invalid", async () => {
    const response = await handlers.PATCH(
      buildRequest("/api/activity/%20/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "todo" }),
      }),
      buildContext(" "),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid issue id.");
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/activity/[id]/status", () => {
  let handlers: RouteHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    ensureSchemaMock.mockResolvedValue(undefined);
    refreshActivityItemsSnapshotMock.mockResolvedValue(undefined);
    readActiveSessionMock.mockResolvedValue(buildSession());
    handlers = await import("./route");
  });

  it("returns 401 when no session is present", async () => {
    readActiveSessionMock.mockResolvedValueOnce(null);

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/status", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not admin", async () => {
    readActiveSessionMock.mockResolvedValueOnce(
      buildSession({ isAdmin: false }),
    );

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/status", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required.",
    });
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
  });

  it("clears activity statuses and returns the refreshed item", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "done" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "no_status" }),
    );

    const response = await handlers.DELETE(
      buildRequest("/api/activity/issue-1/status", {
        method: "DELETE",
      }),
      buildContext("issue-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: ActivityItem };
    expect(body.item.issueProjectStatus).toBe("no_status");
    expect(clearActivityStatusesMock).toHaveBeenCalledWith("issue-1");
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["issue-1"],
    });
  });

  it("returns 400 when the issue id is invalid", async () => {
    const response = await handlers.DELETE(
      buildRequest("/api/activity/%20/status", {
        method: "DELETE",
      }),
      buildContext(" "),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid issue id.");
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue does not exist", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(null);

    const response = await handlers.DELETE(
      buildRequest("/api/activity/missing/status", {
        method: "DELETE",
      }),
      buildContext("missing"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Issue not found.");
    expect(clearActivityStatusesMock).not.toHaveBeenCalled();
    expect(refreshActivityItemsSnapshotMock).not.toHaveBeenCalled();
  });
});
