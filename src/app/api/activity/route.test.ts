// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActivityFilterOptions,
  ActivityItemDetail,
  ActivityListParams,
  ActivityListResult,
} from "@/lib/activity/types";

vi.mock("@/lib/activity/params", () => ({
  parseActivityListParams: vi.fn(),
}));

vi.mock("@/lib/activity/service", () => ({
  getActivityItems: vi.fn(),
  getActivityFilterOptions: vi.fn(),
  getActivityItemDetail: vi.fn(),
}));

const { parseActivityListParams } = vi.mocked(
  await import("@/lib/activity/params"),
);
const { getActivityItems, getActivityFilterOptions, getActivityItemDetail } =
  vi.mocked(await import("@/lib/activity/service"));

describe("GET /api/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns activity items for parsed params", async () => {
    const parsedParams: ActivityListParams = {
      page: 2,
      perPage: 10,
    };
    const listResult: ActivityListResult = {
      items: [],
      pageInfo: {
        page: 2,
        perPage: 10,
        totalCount: 0,
        totalPages: 0,
      },
      lastSyncCompletedAt: null,
      timezone: null,
      dateTimeFormat: "auto",
    };

    parseActivityListParams.mockReturnValue(parsedParams);
    getActivityItems.mockResolvedValue(listResult);

    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/activity?page=2&perPage=10"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as ActivityListResult;
    expect(body).toEqual(listResult);
    expect(parseActivityListParams).toHaveBeenCalledTimes(1);
    expect(getActivityItems).toHaveBeenCalledWith(parsedParams);
  });

  it("returns 500 when service call fails", async () => {
    parseActivityListParams.mockReturnValue({} as ActivityListParams);
    getActivityItems.mockRejectedValue(new Error("boom"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/activity"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Failed to load activity feed." });
  });
});

describe("GET /api/activity/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns filter options", async () => {
    const options: ActivityFilterOptions = {
      repositories: [],
      labels: [],
      users: [],
      issueTypes: [],
      milestones: [],
      issuePriorities: [],
      issueWeights: [],
    };
    getActivityFilterOptions.mockResolvedValue(options);

    const { GET } = await import("./options/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(options);
    expect(getActivityFilterOptions).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when options retrieval fails", async () => {
    getActivityFilterOptions.mockRejectedValue(new Error("boom"));

    const { GET } = await import("./options/route");

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to load activity filters.",
    });
  });
});

describe("GET /api/activity/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid id", async () => {
    const { GET } = await import("./[id]/route");
    const response = await GET(new Request("http://localhost/api/activity"), {
      params: Promise.resolve({ id: "   " }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid activity id.",
    });
    expect(getActivityItemDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when item is not found", async () => {
    getActivityItemDetail.mockResolvedValue(null);

    const { GET } = await import("./[id]/route");
    const response = await GET(new Request("http://localhost/api/activity"), {
      params: Promise.resolve({ id: encodeURIComponent("missing") }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Activity item not found.",
    });
    expect(getActivityItemDetail).toHaveBeenCalledWith("missing");
  });

  it("returns activity detail when available", async () => {
    const detail: ActivityItemDetail = {
      item: {
        id: "activity-1",
        type: "issue",
        number: 123,
        title: "Example",
        url: null,
        state: null,
        status: "open",
        issueProjectStatus: null,
        issueProjectStatusSource: "none",
        issueProjectStatusLocked: false,
        issueTodoProjectStatus: null,
        issueTodoProjectStatusAt: null,
        issueTodoProjectPriority: null,
        issueTodoProjectPriorityUpdatedAt: null,
        issueTodoProjectWeight: null,
        issueTodoProjectWeightUpdatedAt: null,
        issueTodoProjectInitiationOptions: null,
        issueTodoProjectInitiationOptionsUpdatedAt: null,
        issueTodoProjectStartDate: null,
        issueTodoProjectStartDateUpdatedAt: null,
        issueActivityStatus: null,
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
      },
      body: null,
      bodyHtml: null,
      raw: null,
      parentIssues: [],
      subIssues: [],
      comments: [],
      commentCount: 0,
    };

    getActivityItemDetail.mockResolvedValue(detail);

    const { GET } = await import("./[id]/route");

    const response = await GET(new Request("http://localhost/api/activity"), {
      params: Promise.resolve({
        id: encodeURIComponent("activity-1"),
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(getActivityItemDetail).toHaveBeenCalledWith("activity-1");
  });

  it("returns 500 when detail retrieval fails", async () => {
    getActivityItemDetail.mockRejectedValue(new Error("boom"));

    const { GET } = await import("./[id]/route");

    const response = await GET(new Request("http://localhost/api/activity"), {
      params: Promise.resolve({ id: "activity-1" }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to load activity detail.",
    });
  });
});
