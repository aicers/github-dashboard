import { vi } from "vitest";

import type {
  ActivityItem,
  ActivityItemDetail,
  ActivityItemType,
} from "@/lib/activity/types";

function inferActivityType(id: string): ActivityItemType {
  if (id.startsWith("pr-") || id.includes("/pull/")) {
    return "pull_request";
  }
  if (id.startsWith("discussion-")) {
    return "discussion";
  }
  return "issue";
}

function createMockActivityItem(id: string): ActivityItem {
  const type = inferActivityType(id);
  return {
    id,
    type,
    number: null,
    title: `Mock ${id}`,
    url: `https://example.com/${id}`,
    state: "open",
    status: type === "pull_request" ? "open" : "open",
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
    discussionAnsweredAt: null,
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
    attention: {
      unansweredMention: false,
      reviewRequestPending: false,
      staleOpenPr: false,
      idlePr: false,
      backlogIssue: false,
      stalledIssue: false,
    },
  };
}

function createMockActivityDetail(id: string): ActivityItemDetail {
  return {
    item: createMockActivityItem(id),
    body: null,
    bodyHtml: null,
    raw: null,
    parentIssues: [],
    subIssues: [],
    comments: [],
    commentCount: 0,
    linkedPullRequests: [],
    linkedIssues: [],
    reactions: [],
  };
}

export const fetchActivityDetailMock = vi.fn(async (id: string) =>
  createMockActivityDetail(id),
);

vi.mock("@/lib/activity/client", () => ({
  fetchActivityDetail: fetchActivityDetailMock,
}));
