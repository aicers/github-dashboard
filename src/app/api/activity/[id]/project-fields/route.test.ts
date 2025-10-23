// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityItem, ActivityItemDetail } from "@/lib/activity/types";

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
      staleOpenPr: false,
      idlePr: false,
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
    todoStatusTimes: {},
    activityStatusTimes: {},
  };
}

function buildContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}

describe("PATCH /api/activity/[id]/project-fields", () => {
  let handlers: RouteHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    refreshActivityItemsSnapshotMock.mockResolvedValue(undefined);
    handlers = await import("./route");
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
      new Request("http://localhost/api/activity/issue-1/project-fields", {
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
      new Request("http://localhost/api/activity/issue-1/project-fields", {
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
      new Request("http://localhost/api/activity/issue-1/project-fields", {
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
      new Request("http://localhost/api/activity/issue-1/project-fields", {
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
      new Request("http://localhost/api/activity/%20/project-fields", {
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
      new Request("http://localhost/api/activity/missing/project-fields", {
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
      new Request("http://localhost/api/activity/pr-1/project-fields", {
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
    handlers = await import("./route");
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
      new Request("http://localhost/api/activity/issue-1/project-fields", {
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
      new Request("http://localhost/api/activity/issue-1/project-fields", {
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
      new Request("http://localhost/api/activity/%20/project-fields", {
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
      new Request("http://localhost/api/activity/missing/project-fields", {
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
