// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityItem, ActivityItemDetail } from "@/lib/activity/types";

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
    todoStatusTimes: {},
    activityStatusTimes: {},
  };
}

function buildContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}

describe("PATCH /api/activity/[id]/status", () => {
  let handlers: RouteHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    ensureSchemaMock.mockResolvedValue(undefined);
    handlers = await import("./route");
  });

  it("updates the issue status and returns the refreshed item", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "todo" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "done" }),
    );

    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/issue-1/status", {
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
  });

  it("clears the issue status when requesting no_status", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "todo" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "no_status" }),
    );

    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/issue-1/status", {
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
  });

  it("returns a conflict when the expected status does not match the current status", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "done" }),
    );
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({ issueProjectStatus: "in_progress" }),
    );

    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/issue-1/status", {
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
  });

  it("returns a conflict when the status is locked by the to-do project", async () => {
    getActivityItemDetailMock.mockResolvedValueOnce(
      createDetail({
        issueProjectStatusLocked: true,
        issueTodoProjectStatus: "done",
      }),
    );

    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/issue-1/status", {
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
  });
});
