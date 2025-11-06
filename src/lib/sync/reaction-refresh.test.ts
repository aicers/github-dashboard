import type { GraphQLClient } from "graphql-request";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshAttentionReactions } from "@/lib/sync/reaction-refresh";

const {
  fetchUnansweredMentionCandidatesMock,
  fetchStuckReviewRequestsMock,
  normalizeOrganizationHolidayCodesMock,
  loadCombinedHolidaySetMock,
  ensureSchemaMock,
  getSyncConfigMock,
  listCommentIdsByPullRequestIdsMock,
  listReviewIdsByPullRequestIdsMock,
  upsertReactionMock,
  createGithubClientMock,
} = vi.hoisted(() => ({
  fetchUnansweredMentionCandidatesMock: vi.fn(),
  fetchStuckReviewRequestsMock: vi.fn(),
  normalizeOrganizationHolidayCodesMock: vi.fn(() => []),
  loadCombinedHolidaySetMock: vi.fn(async () => new Set<string>()),
  ensureSchemaMock: vi.fn(async () => {}),
  getSyncConfigMock: vi.fn(async () => ({
    excluded_repository_ids: [],
    excluded_user_ids: [],
  })),
  listCommentIdsByPullRequestIdsMock: vi.fn(async () => new Map()),
  listReviewIdsByPullRequestIdsMock: vi.fn(async () => new Map()),
  upsertReactionMock: vi.fn(async () => {}),
  createGithubClientMock: vi.fn<() => GraphQLClient>(),
}));

vi.mock("@/lib/dashboard/attention", () => ({
  fetchUnansweredMentionCandidates: fetchUnansweredMentionCandidatesMock,
  fetchStuckReviewRequests: fetchStuckReviewRequestsMock,
  normalizeOrganizationHolidayCodes: normalizeOrganizationHolidayCodesMock,
}));

vi.mock("@/lib/dashboard/business-days", () => ({
  loadCombinedHolidaySet: loadCombinedHolidaySetMock,
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: ensureSchemaMock,
}));

vi.mock("@/lib/db/operations", () => ({
  getSyncConfig: getSyncConfigMock,
  listCommentIdsByPullRequestIds: listCommentIdsByPullRequestIdsMock,
  listReviewIdsByPullRequestIds: listReviewIdsByPullRequestIdsMock,
  upsertReaction: upsertReactionMock,
}));

vi.mock("@/lib/github/client", () => ({
  createGithubClient: createGithubClientMock,
}));

function createClientMock() {
  const request = vi.fn();
  createGithubClientMock.mockReturnValueOnce({
    request,
  } as unknown as GraphQLClient);
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  createGithubClientMock.mockReset();
  normalizeOrganizationHolidayCodesMock.mockReturnValue([]);
  loadCombinedHolidaySetMock.mockResolvedValue(new Set());
  getSyncConfigMock.mockResolvedValue({
    excluded_repository_ids: [],
    excluded_user_ids: [],
  });
  listCommentIdsByPullRequestIdsMock.mockResolvedValue(new Map());
  listReviewIdsByPullRequestIdsMock.mockResolvedValue(new Map());
});

describe("refreshAttentionReactions", () => {
  it("refreshes reactions for unanswered mentions and review requests", async () => {
    fetchUnansweredMentionCandidatesMock.mockResolvedValueOnce([
      {
        commentId: "C1",
      } as unknown as import("@/lib/dashboard/attention").MentionDatasetItem,
    ]);

    fetchStuckReviewRequestsMock.mockResolvedValueOnce({
      items: [
        {
          id: "RR1",
          pullRequest: { id: "PR1" },
        },
      ] as unknown as import("@/lib/dashboard/attention").ReviewRequestRawItem[],
      userIds: new Set<string>(),
    });

    listCommentIdsByPullRequestIdsMock.mockResolvedValueOnce(
      new Map([["PR1", ["RC1", "RC2"]]]),
    );
    listReviewIdsByPullRequestIdsMock.mockResolvedValueOnce(
      new Map([["PR1", ["RV1"]]]),
    );

    const request = createClientMock();
    request.mockImplementation(async (_query, variables: { id: string }) => {
      const typenameMap: Record<string, string> = {
        C1: "IssueComment",
        PR1: "PullRequest",
        RC1: "PullRequestReviewComment",
        RC2: "PullRequestReviewComment",
        RV1: "PullRequestReview",
      };
      const typename = typenameMap[variables.id];
      if (!typename) {
        return { node: null };
      }
      return {
        node: {
          __typename: typename,
          id: variables.id,
          reactions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: `${variables.id}-reaction`,
                content: "THUMBS_UP",
                createdAt: "2024-01-01T00:00:00.000Z",
                user: { id: `user-${variables.id}` },
              },
            ],
          },
        },
      };
    });

    const logger = vi.fn();
    await refreshAttentionReactions({ logger });

    expect(createGithubClientMock).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(5);
    expect(upsertReactionMock).toHaveBeenCalledTimes(5);
    expect(upsertReactionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        subjectId: "C1",
        subjectType: "issuecomment",
        userId: "user-C1",
      }),
    );
    expect(upsertReactionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        subjectId: "PR1",
        subjectType: "pullrequest",
        userId: "user-PR1",
      }),
    );
    expect(upsertReactionMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        subjectId: "RC1",
        subjectType: "pullrequestreviewcomment",
        userId: "user-RC1",
      }),
    );
    expect(upsertReactionMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        subjectId: "RC2",
        subjectType: "pullrequestreviewcomment",
        userId: "user-RC2",
      }),
    );
    expect(upsertReactionMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        subjectId: "RV1",
        subjectType: "pullrequestreview",
        userId: "user-RV1",
      }),
    );
    expect(logger).toHaveBeenCalledWith(
      "[reaction-refresh] Completed reaction refresh for 5 node(s); upserted 5 reaction(s)",
    );
  });

  it("skips refresh when there are no targets", async () => {
    fetchUnansweredMentionCandidatesMock.mockResolvedValueOnce([]);
    fetchStuckReviewRequestsMock.mockResolvedValueOnce({
      items: [],
      userIds: new Set<string>(),
    });

    const logger = vi.fn();
    await refreshAttentionReactions({ logger });

    expect(createGithubClientMock).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      "[reaction-refresh] No unanswered mentions or review requests require reaction refresh",
    );
  });
});
