import { GraphQLError } from "graphql";
import type { GraphQLClient } from "graphql-request";
import { ClientError } from "graphql-request";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGithubClient } from "@/lib/github/client";
import { runCollection } from "@/lib/github/collectors";
import {
  discussionCommentRepliesQuery,
  discussionCommentsQuery,
  issueCommentsQuery,
  openIssueMetadataQuery,
  openPullRequestMetadataQuery,
  organizationRepositoriesQuery,
  pullRequestCommentsQuery,
  pullRequestMetadataByNumberQuery,
  pullRequestReviewCommentsQuery,
  pullRequestReviewsQuery,
  repositoryDiscussionsQuery,
  repositoryIssuesQuery,
  repositoryPullRequestsQuery,
} from "@/lib/github/queries";

const {
  recordSyncLogMock,
  updateSyncLogMock,
  updateSyncStateMock,
  upsertRepositoryMock,
  upsertUserMock,
  upsertIssueMock,
  upsertPullRequestMock,
  replacePullRequestIssuesMock,
  upsertReviewMock,
  upsertReviewRequestMock,
  upsertCommentMock,
  upsertReactionMock,
  markReviewRequestRemovedMock,
  fetchIssueRawMapMock,
  reviewExistsMock,
  updateIssueAssigneesMock,
  updatePullRequestAssigneesMock,
  listExistingPullRequestIdsMock,
  listPendingReviewRequestsMock,
  deleteReactionsForSubjectMock,
  deleteMissingCommentsForTargetMock,
  resetLogSequence,
  nextLogId,
} = vi.hoisted(() => {
  let logIdValue = 0;
  return {
    recordSyncLogMock: vi.fn(async () => {
      logIdValue += 1;
      return logIdValue;
    }),
    updateSyncLogMock: vi.fn(async () => {}),
    updateSyncStateMock: vi.fn(async () => {}),
    upsertRepositoryMock: vi.fn(async () => {}),
    upsertUserMock: vi.fn(async () => {}),
    upsertIssueMock: vi.fn(async () => {}),
    upsertPullRequestMock: vi.fn(async () => {}),
    replacePullRequestIssuesMock: vi.fn(async () => {}),
    upsertReviewMock: vi.fn(async () => {}),
    upsertReviewRequestMock: vi.fn(async () => {}),
    upsertCommentMock: vi.fn(async () => {}),
    upsertReactionMock: vi.fn(async () => {}),
    markReviewRequestRemovedMock: vi.fn(async () => {}),
    fetchIssueRawMapMock: vi.fn(async () => new Map()),
    reviewExistsMock: vi.fn(async () => false),
    updateIssueAssigneesMock: vi.fn(async () => {}),
    updatePullRequestAssigneesMock: vi.fn(async () => {}),
    listExistingPullRequestIdsMock: vi.fn(
      async (ids: readonly string[]) => new Set(ids),
    ),
    listPendingReviewRequestsMock: vi.fn(async () => new Map()),
    deleteReactionsForSubjectMock: vi.fn(async () => {}),
    deleteMissingCommentsForTargetMock: vi.fn(async () => 0),
    resetLogSequence: () => {
      logIdValue = 0;
    },
    nextLogId: () => {
      logIdValue += 1;
      return logIdValue;
    },
  };
});

vi.mock("@/lib/db/operations", () => ({
  recordSyncLog: (...args: Parameters<typeof recordSyncLogMock>) =>
    recordSyncLogMock(...args),
  updateSyncLog: (...args: Parameters<typeof updateSyncLogMock>) =>
    updateSyncLogMock(...args),
  updateSyncState: (...args: Parameters<typeof updateSyncStateMock>) =>
    updateSyncStateMock(...args),
  upsertRepository: (...args: Parameters<typeof upsertRepositoryMock>) =>
    upsertRepositoryMock(...args),
  upsertUser: (...args: Parameters<typeof upsertUserMock>) =>
    upsertUserMock(...args),
  upsertIssue: (...args: Parameters<typeof upsertIssueMock>) =>
    upsertIssueMock(...args),
  upsertPullRequest: (...args: Parameters<typeof upsertPullRequestMock>) =>
    upsertPullRequestMock(...args),
  replacePullRequestIssues: (
    ...args: Parameters<typeof replacePullRequestIssuesMock>
  ) => replacePullRequestIssuesMock(...args),
  upsertReview: (...args: Parameters<typeof upsertReviewMock>) =>
    upsertReviewMock(...args),
  upsertReviewRequest: (...args: Parameters<typeof upsertReviewRequestMock>) =>
    upsertReviewRequestMock(...args),
  upsertComment: (...args: Parameters<typeof upsertCommentMock>) =>
    upsertCommentMock(...args),
  upsertReaction: (...args: Parameters<typeof upsertReactionMock>) =>
    upsertReactionMock(...args),
  markReviewRequestRemoved: (
    ...args: Parameters<typeof markReviewRequestRemovedMock>
  ) => markReviewRequestRemovedMock(...args),
  fetchIssueRawMap: (...args: Parameters<typeof fetchIssueRawMapMock>) =>
    fetchIssueRawMapMock(...args),
  reviewExists: (...args: Parameters<typeof reviewExistsMock>) =>
    reviewExistsMock(...args),
  updateIssueAssignees: (
    ...args: Parameters<typeof updateIssueAssigneesMock>
  ) => updateIssueAssigneesMock(...args),
  updatePullRequestAssignees: (
    ...args: Parameters<typeof updatePullRequestAssigneesMock>
  ) => updatePullRequestAssigneesMock(...args),
  listExistingPullRequestIds: (
    ...args: Parameters<typeof listExistingPullRequestIdsMock>
  ) => listExistingPullRequestIdsMock(...args),
  listPendingReviewRequestsByPullRequestIds: (
    ...args: Parameters<typeof listPendingReviewRequestsMock>
  ) => listPendingReviewRequestsMock(...args),
  deleteReactionsForSubject: (
    ...args: Parameters<typeof deleteReactionsForSubjectMock>
  ) => deleteReactionsForSubjectMock(...args),
  deleteMissingCommentsForTarget: (
    ...args: Parameters<typeof deleteMissingCommentsForTargetMock>
  ) => deleteMissingCommentsForTargetMock(...args),
}));

vi.mock("@/lib/github/client", () => ({
  createGithubClient: vi.fn(() => {
    throw new Error(
      "createGithubClient should not be called when client is injected.",
    );
  }),
}));

const emptyConnection = {
  nodes: [],
  pageInfo: { hasNextPage: false, endCursor: null },
} as const;

type TestQueryVariables = {
  cursor?: string | null;
  number?: number;
  [key: string]: unknown;
};

function createRequestMockForOpenPullRequestMetadata(params: {
  openPullRequests: unknown;
  pullRequestMetadataByNumber?:
    | ((variables: TestQueryVariables) => unknown | Promise<unknown>)
    | null;
}) {
  const { openPullRequests, pullRequestMetadataByNumber = null } = params;

  return vi.fn(
    async (document: unknown, variables: TestQueryVariables = {}) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-1",
                    login: "owner",
                    name: "Owner",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    __typename: "User",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === repositoryDiscussionsQuery) {
        return { repository: { discussions: emptyConnection } };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === issueCommentsQuery) {
        return { repository: { issue: { comments: emptyConnection } } };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: { discussion: { comments: emptyConnection } },
        };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return {
          repository: {
            pullRequests: openPullRequests,
          },
        };
      }

      if (document === pullRequestMetadataByNumberQuery) {
        if (!pullRequestMetadataByNumber) {
          throw new Error("Unexpected pullRequestMetadataByNumberQuery");
        }
        return pullRequestMetadataByNumber(variables);
      }

      throw new Error("Unexpected query");
    },
  );
}

describe("runCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLogSequence();
    recordSyncLogMock.mockImplementation(async () => nextLogId());
    fetchIssueRawMapMock.mockImplementation(async () => new Map());
    reviewExistsMock.mockResolvedValue(false);
    listExistingPullRequestIdsMock.mockImplementation(
      async (ids: readonly string[]) => new Set(ids),
    );
  });

  it("uses an injected GraphQL client and completes when no data is returned", async () => {
    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: emptyConnection,
          },
        };
      }

      return {};
    });

    const result = await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(requestMock).toHaveBeenCalledWith(
      organizationRepositoriesQuery,
      expect.objectContaining({ login: "acme", cursor: null }),
    );
    expect(result).toEqual({
      repositoriesProcessed: 0,
      counts: {
        issues: 0,
        discussions: 0,
        pullRequests: 0,
        reviews: 0,
        comments: 0,
      },
      timestamps: {
        repositories: null,
        issues: null,
        discussions: null,
        pullRequests: null,
        reviews: null,
        comments: null,
      },
    });
    expect(createGithubClient).not.toHaveBeenCalled();
  });

  it("paginates repositories and updates sync state with the latest timestamp", async () => {
    const repoPageOne = {
      nodes: [
        {
          id: "repo-1",
          name: "repo-one",
          nameWithOwner: "acme/repo-one",
          url: "https://github.com/acme/repo-one",
          isPrivate: false,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
          owner: {
            id: "owner-1",
            login: "owner",
            name: "Owner",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
    };
    const repoPageTwo = {
      nodes: [
        {
          id: "repo-2",
          name: "repo-two",
          nameWithOwner: "acme/repo-two",
          url: "https://github.com/acme/repo-two",
          isPrivate: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-03T00:00:00.000Z",
          owner: {
            id: "owner-2",
            login: "owner-two",
            name: "Owner Two",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    const emptyThreads = {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    type RepositoryQueryVariables = {
      cursor?: string | null;
      [key: string]: unknown;
    };

    const requestMock = vi.fn(
      async (document: unknown, variables: RepositoryQueryVariables = {}) => {
        if (document === organizationRepositoriesQuery) {
          return {
            organization: {
              repositories: variables.cursor ? repoPageTwo : repoPageOne,
            },
          };
        }

        if (document === repositoryIssuesQuery) {
          return { repository: { issues: emptyConnection } };
        }

        if (document === repositoryDiscussionsQuery) {
          return { repository: { discussions: emptyConnection } };
        }

        if (document === repositoryPullRequestsQuery) {
          return { repository: { pullRequests: emptyConnection } };
        }

        if (document === issueCommentsQuery) {
          return { repository: { issue: { comments: emptyConnection } } };
        }

        if (document === discussionCommentsQuery) {
          return {
            repository: { discussion: { comments: emptyConnection } },
          };
        }

        if (document === pullRequestCommentsQuery) {
          return { repository: { pullRequest: { comments: emptyConnection } } };
        }

        if (document === pullRequestReviewsQuery) {
          return { repository: { pullRequest: { reviews: emptyConnection } } };
        }

        if (document === pullRequestReviewCommentsQuery) {
          return {
            repository: { pullRequest: { reviewThreads: emptyThreads } },
          };
        }

        if (document === openIssueMetadataQuery) {
          return { repository: { issues: emptyConnection } };
        }

        if (document === openPullRequestMetadataQuery) {
          return { repository: { pullRequests: emptyConnection } };
        }

        throw new Error("Unexpected query");
      },
    );

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(requestMock).toHaveBeenCalledWith(
      organizationRepositoriesQuery,
      expect.objectContaining({ login: "acme", cursor: null }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      organizationRepositoriesQuery,
      expect.objectContaining({ login: "acme", cursor: "cursor-1" }),
    );
    expect(upsertRepositoryMock).toHaveBeenCalledTimes(2);
    expect(updateSyncStateMock).toHaveBeenCalledWith(
      "repositories",
      null,
      "2024-01-03T00:00:00.000Z",
    );
  });

  it("filters comments outside of the requested since/until window", async () => {
    const issueNode = {
      id: "issue-1",
      number: 42,
      title: "Example issue",
      state: "OPEN",
      url: "https://github.com/acme/repo/issues/42",
      createdAt: "2024-04-01T12:00:00.000Z",
      updatedAt: "2024-04-02T10:00:00.000Z",
      author: {
        id: "author-1",
        login: "author",
        name: "Author",
        avatarUrl: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        __typename: "User",
      },
      trackedIssues: null,
      trackedInIssues: null,
      timelineItems: null,
      projectItems: null,
      reactions: null,
    };

    const commentConnection = {
      nodes: [
        {
          id: "comment-before",
          author: {
            id: "author-2",
            login: "before",
            name: "Before",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
          createdAt: "2024-03-31T23:00:00.000Z",
          updatedAt: null,
          pullRequestReview: null,
          reactions: null,
        },
        {
          id: "comment-in-range",
          author: {
            id: "author-3",
            login: "inrange",
            name: "In Range",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
          createdAt: "2024-04-02T09:00:00.000Z",
          updatedAt: null,
          pullRequestReview: null,
          reactions: null,
        },
        {
          id: "comment-after",
          author: {
            id: "author-4",
            login: "after",
            name: "After",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
          createdAt: "2024-04-03T00:00:00.000Z",
          updatedAt: null,
          pullRequestReview: null,
          reactions: null,
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    fetchIssueRawMapMock.mockResolvedValue(new Map());

    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-1",
                    login: "owner",
                    name: "Owner",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    __typename: "User",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return {
          repository: {
            issues: {
              nodes: [issueNode],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryDiscussionsQuery) {
        return { repository: { discussions: emptyConnection } };
      }

      if (document === issueCommentsQuery) {
        return {
          repository: {
            issue: {
              comments: commentConnection,
            },
          },
        };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: { discussion: { comments: emptyConnection } },
        };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      throw new Error("Unexpected query");
    });

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
      since: "2024-04-01T00:00:00.000Z",
      until: "2024-04-03T00:00:00.000Z",
    });

    const commentCalls = upsertCommentMock.mock.calls as unknown as Array<
      [{ id?: string | null }]
    >;
    const upsertedCommentIds = commentCalls.map(
      ([payload]) => payload?.id ?? null,
    );
    expect(upsertedCommentIds).toEqual(["comment-in-range"]);
  });

  it("collects discussions and their comments", async () => {
    const discussionNode = {
      __typename: "Discussion" as const,
      id: "discussion-1",
      number: 7,
      title: "RFC: roadmap",
      url: "https://github.com/acme/repo/discussions/7",
      body: "Let's discuss",
      bodyText: "Let's discuss",
      bodyHTML: "<p>Let's discuss</p>",
      createdAt: "2024-04-01T12:00:00.000Z",
      updatedAt: "2024-04-02T10:00:00.000Z",
      closedAt: null,
      answerChosenAt: null,
      locked: false,
      author: {
        id: "author-discussion",
        login: "discussant",
        name: "Discussant",
        avatarUrl: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        __typename: "User",
      },
      answerChosenBy: null,
      category: {
        id: "category-1",
        name: "Ideas",
        description: null,
        isAnswerable: true,
      },
      comments: { totalCount: 1 },
      reactions: null,
    } satisfies Record<string, unknown>;

    const discussionCommentConnection = {
      nodes: [
        {
          __typename: "DiscussionComment",
          id: "discussion-comment-1",
          isAnswer: false,
          author: {
            id: "author-comment",
            login: "participant",
            name: "Participant",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
          createdAt: "2024-04-02T09:00:00.000Z",
          updatedAt: null,
          url: "https://github.com/acme/repo/discussions/7#comment-1",
          body: "Please review @user",
          bodyText: "Please review @user",
          bodyHTML: "<p>Please review @user</p>",
          replyTo: null,
          pullRequestReview: null,
          reactions: null,
          replies: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                __typename: "DiscussionComment",
                id: "discussion-reply-1",
                isAnswer: false,
                author: {
                  id: "author-reply",
                  login: "responder",
                  name: "Responder",
                  avatarUrl: null,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-01-01T00:00:00.000Z",
                  __typename: "User",
                },
                createdAt: "2024-04-02T09:30:00.000Z",
                updatedAt: null,
                url: "https://github.com/acme/repo/discussions/7#reply-1",
                body: "Replying here",
                bodyText: "Replying here",
                bodyHTML: "<p>Replying here</p>",
                replyTo: { id: "discussion-comment-1" },
                pullRequestReview: null,
                reactions: null,
                replies: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [],
                },
              },
            ],
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-1",
                    login: "owner",
                    name: "Owner",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    __typename: "User",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === repositoryDiscussionsQuery) {
        return {
          repository: {
            discussions: {
              nodes: [discussionNode],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: {
            discussion: {
              comments: discussionCommentConnection,
            },
          },
        };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      throw new Error("Unexpected query");
    });

    const result = await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(upsertIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "discussion-1", repositoryId: "repo-1" }),
    );
    expect(upsertCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "discussion-comment-1",
        issueId: "discussion-1",
      }),
    );
    const discussionCommentCalls = upsertCommentMock.mock
      .calls as unknown as Array<unknown[]>;
    const discussionCommentIds = discussionCommentCalls
      .map((call) => {
        const payload = call[0] as { id?: string | null } | undefined;
        return payload?.id ?? null;
      })
      .filter((id): id is string => Boolean(id));
    expect(discussionCommentIds).toEqual(
      expect.arrayContaining(["discussion-comment-1", "discussion-reply-1"]),
    );
    expect(result.counts.discussions).toBe(1);
    expect(updateSyncStateMock).toHaveBeenCalledWith(
      "discussions",
      null,
      "2024-04-02T10:00:00.000Z",
    );
  });

  it("fetches paginated discussion replies", async () => {
    const discussionNode = {
      __typename: "Discussion" as const,
      id: "discussion-2",
      number: 42,
      title: "Thread",
      url: "https://github.com/acme/repo/discussions/42",
      body: "Root",
      bodyText: "Root",
      bodyHTML: "<p>Root</p>",
      createdAt: "2024-04-01T12:00:00.000Z",
      updatedAt: "2024-04-02T10:00:00.000Z",
      closedAt: null,
      answerChosenAt: null,
      locked: false,
      author: {
        id: "author-discussion-2",
        login: "threadstarter",
        name: "Thread Starter",
        avatarUrl: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        __typename: "User",
      },
      answerChosenBy: null,
      category: null,
      comments: { totalCount: 1 },
      reactions: null,
    } satisfies Record<string, unknown>;

    const discussionCommentConnection = {
      nodes: [
        {
          __typename: "DiscussionComment",
          id: "discussion-comment-2",
          isAnswer: false,
          author: {
            id: "author-comment-2",
            login: "participant",
            name: "Participant",
            avatarUrl: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            __typename: "User",
          },
          createdAt: "2024-04-02T09:00:00.000Z",
          updatedAt: null,
          url: "https://github.com/acme/repo/discussions/42#comment-2",
          body: "Ping",
          bodyText: "Ping",
          bodyHTML: "<p>Ping</p>",
          replyTo: null,
          pullRequestReview: null,
          reactions: null,
          replies: {
            pageInfo: { hasNextPage: true, endCursor: "reply-cursor-1" },
            nodes: [],
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };

    const requestMock = vi.fn(
      async (document: unknown, variables?: Record<string, unknown>) => {
        if (document === organizationRepositoriesQuery) {
          return {
            organization: {
              repositories: {
                nodes: [
                  {
                    id: "repo-2",
                    name: "repo",
                    nameWithOwner: "acme/repo",
                    url: "https://github.com/acme/repo",
                    isPrivate: false,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-04-02T12:00:00.000Z",
                    owner: {
                      id: "owner-1",
                      login: "owner",
                      name: "Owner",
                      avatarUrl: null,
                      createdAt: "2024-01-01T00:00:00.000Z",
                      updatedAt: "2024-01-01T00:00:00.000Z",
                      __typename: "User",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        }

        if (document === repositoryIssuesQuery) {
          return { repository: { issues: emptyConnection } };
        }

        if (document === repositoryDiscussionsQuery) {
          return {
            repository: {
              discussions: {
                nodes: [discussionNode],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        }

        if (document === discussionCommentsQuery) {
          return {
            repository: {
              discussion: {
                comments: discussionCommentConnection,
              },
            },
          };
        }

        if (document === discussionCommentRepliesQuery) {
          expect(variables).toEqual({
            id: "discussion-comment-2",
            cursor: "reply-cursor-1",
          });
          return {
            node: {
              __typename: "DiscussionComment",
              replies: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    __typename: "DiscussionComment",
                    id: "discussion-reply-extra",
                    isAnswer: false,
                    author: {
                      id: "author-reply-extra",
                      login: "helper",
                      name: "Helper",
                      avatarUrl: null,
                      createdAt: "2024-01-01T00:00:00.000Z",
                      updatedAt: "2024-01-01T00:00:00.000Z",
                      __typename: "User",
                    },
                    createdAt: "2024-04-02T10:00:00.000Z",
                    updatedAt: null,
                    url: "https://github.com/acme/repo/discussions/42#reply-extra",
                    body: "Extra reply",
                    bodyText: "Extra reply",
                    bodyHTML: "<p>Extra reply</p>",
                    replyTo: { id: "discussion-comment-2" },
                    pullRequestReview: null,
                    reactions: null,
                    replies: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [],
                    },
                  },
                ],
              },
            },
          };
        }

        if (document === repositoryPullRequestsQuery) {
          return { repository: { pullRequests: emptyConnection } };
        }

        if (document === pullRequestCommentsQuery) {
          return { repository: { pullRequest: { comments: emptyConnection } } };
        }

        if (document === pullRequestReviewsQuery) {
          return { repository: { pullRequest: { reviews: emptyConnection } } };
        }

        if (document === pullRequestReviewCommentsQuery) {
          return {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          };
        }

        if (document === openIssueMetadataQuery) {
          return { repository: { issues: emptyConnection } };
        }

        if (document === openPullRequestMetadataQuery) {
          return { repository: { pullRequests: emptyConnection } };
        }

        throw new Error("Unexpected query");
      },
    );

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(requestMock).toHaveBeenCalledWith(
      discussionCommentRepliesQuery,
      expect.objectContaining({
        id: "discussion-comment-2",
        cursor: "reply-cursor-1",
      }),
    );
    expect(upsertCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "discussion-reply-extra",
        issueId: "discussion-2",
      }),
    );
  });

  it("stores discussion answers even when they are only returned via the answer field", async () => {
    const discussionNode = {
      __typename: "Discussion" as const,
      id: "discussion-1",
      number: 42,
      title: "How do I repro?",
      url: "https://github.com/acme/repo/discussions/42",
      body: "What is the repro?",
      bodyText: "What is the repro?",
      bodyHTML: "<p>What is the repro?</p>",
      createdAt: "2024-04-02T09:30:00.000Z",
      updatedAt: "2024-04-02T10:00:00.000Z",
      closedAt: null,
      answerChosenAt: null,
      locked: false,
      author: {
        id: "asker-1",
        login: "asker",
        name: "Asker",
        avatarUrl: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        __typename: "User",
      },
      answerChosenBy: null,
      category: null,
      comments: { totalCount: 1 },
      reactions: null,
    } satisfies Record<string, unknown>;

    const answerComment = {
      id: "discussion-answer-comment-1",
      author: {
        id: "helper-1",
        login: "helper",
        name: "Helper",
        avatarUrl: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        __typename: "User",
      },
      createdAt: "2024-04-02T09:45:00.000Z",
      updatedAt: null,
      replyTo: null,
      reactions: null,
      url: "https://github.com/acme/repo/discussions/42#answer-1",
      body: "Thanks!",
      bodyText: "Thanks!",
      bodyHTML: "<p>Thanks!</p>",
    };

    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-1",
                    login: "owner",
                    name: "Owner",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    __typename: "User",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === repositoryDiscussionsQuery) {
        return {
          repository: {
            discussions: {
              nodes: [discussionNode],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: {
            discussion: {
              answer: answerComment,
              comments: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      throw new Error("Unexpected query");
    });

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(upsertCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "discussion-answer-comment-1",
        issueId: "discussion-1",
      }),
    );
  });

  it("stores closed discussions with closed state and timestamp", async () => {
    const discussionNode = {
      __typename: "Discussion" as const,
      id: "discussion-closed",
      number: 9,
      title: "Resolved thread",
      url: "https://github.com/acme/repo/discussions/9",
      body: "Closed discussion body",
      bodyText: "Closed discussion body",
      bodyHTML: "<p>Closed discussion body</p>",
      createdAt: "2024-04-01T12:00:00.000Z",
      updatedAt: "2024-04-02T10:00:00.000Z",
      closedAt: "2024-04-02T09:30:00.000Z",
      answerChosenAt: "2024-04-02T09:00:00.000Z",
      locked: true,
      author: {
        id: "discussion-author",
        login: "closer",
        name: "Closer",
        avatarUrl: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        __typename: "User",
      },
      answerChosenBy: null,
      category: null,
      comments: { totalCount: 0 },
      reactions: null,
    } satisfies Record<string, unknown>;

    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-1",
                    login: "owner",
                    name: "Owner",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    __typename: "User",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === repositoryDiscussionsQuery) {
        return {
          repository: {
            discussions: {
              nodes: [discussionNode],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: {
            discussion: {
              comments: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      throw new Error("Unexpected query");
    });

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(upsertIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "discussion-closed",
        state: "closed",
        closedAt: "2024-04-02T09:30:00.000Z",
      }),
    );
  });

  it("retries after rate limits and succeeds once the request passes", async () => {
    vi.useFakeTimers();

    const graphQlRateLimitError = new GraphQLError("rate limited", {
      extensions: { code: "RATE_LIMIT" },
    });

    const rateLimitError = new ClientError(
      {
        data: null,
        errors: [graphQlRateLimitError],
        status: 429,
        headers: {
          get: (key: string) =>
            key.toLowerCase() === "retry-after" ? "1" : null,
        } as unknown as Headers,
        body: "",
      },
      { query: "query", variables: {} },
    );

    let attempt = 0;

    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        attempt += 1;
        if (attempt === 1) {
          throw rateLimitError;
        }
        return {
          organization: {
            repositories: emptyConnection,
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === repositoryDiscussionsQuery) {
        return { repository: { discussions: emptyConnection } };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === issueCommentsQuery) {
        return { repository: { issue: { comments: emptyConnection } } };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: { discussion: { comments: emptyConnection } },
        };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      throw new Error("Unexpected query");
    });

    const collectionPromise = runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await collectionPromise;

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(updateSyncLogMock).toHaveBeenCalledWith(
      expect.any(Number),
      "success",
      expect.stringContaining("Processed 0 repositories"),
    );

    vi.useRealTimers();
  });

  it("retries review request sync in the same run when pull request rows are missing", async () => {
    listExistingPullRequestIdsMock.mockResolvedValue(new Set());

    const requestMock = vi.fn(async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-1",
                    login: "owner",
                    name: "Owner",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    __typename: "User",
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === repositoryIssuesQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === repositoryDiscussionsQuery) {
        return { repository: { discussions: emptyConnection } };
      }

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === issueCommentsQuery) {
        return { repository: { issue: { comments: emptyConnection } } };
      }

      if (document === discussionCommentsQuery) {
        return {
          repository: { discussion: { comments: emptyConnection } },
        };
      }

      if (document === pullRequestCommentsQuery) {
        return { repository: { pullRequest: { comments: emptyConnection } } };
      }

      if (document === pullRequestReviewsQuery) {
        return { repository: { pullRequest: { reviews: emptyConnection } } };
      }

      if (document === pullRequestReviewCommentsQuery) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }

      if (document === openIssueMetadataQuery) {
        return { repository: { issues: emptyConnection } };
      }

      if (document === openPullRequestMetadataQuery) {
        return {
          repository: {
            pullRequests: {
              nodes: [
                {
                  id: "pr-1",
                  number: 42,
                  assignees: { nodes: [] },
                  reviewRequests: {
                    nodes: [
                      {
                        id: "rr-1",
                        requestedReviewer: {
                          __typename: "User",
                          id: "reviewer-1",
                          login: "reviewer",
                          name: "Reviewer",
                          avatarUrl: null,
                          createdAt: "2024-01-01T00:00:00.000Z",
                          updatedAt: "2024-01-01T00:00:00.000Z",
                        },
                      },
                    ],
                  },
                  timelineItems: {
                    nodes: [
                      {
                        __typename: "ReviewRequestedEvent",
                        createdAt: "2024-04-02T10:00:00.000Z",
                        requestedReviewer: {
                          __typename: "User",
                          id: "reviewer-1",
                        },
                      },
                    ],
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      if (document === pullRequestMetadataByNumberQuery) {
        return {
          repository: {
            pullRequest: {
              id: "pr-1",
              number: 42,
              title: "PR title",
              state: "OPEN",
              createdAt: "2024-04-01T10:00:00.000Z",
              updatedAt: "2024-04-02T10:00:00.000Z",
              closedAt: null,
              merged: false,
              mergedAt: null,
              author: {
                __typename: "User",
                id: "author-1",
                login: "author",
                name: "Author",
                avatarUrl: null,
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
              assignees: { nodes: [] },
              reviewRequests: {
                nodes: [
                  {
                    id: "rr-1",
                    requestedReviewer: {
                      __typename: "User",
                      id: "reviewer-1",
                      login: "reviewer",
                      name: "Reviewer",
                      avatarUrl: null,
                      createdAt: "2024-01-01T00:00:00.000Z",
                      updatedAt: "2024-01-01T00:00:00.000Z",
                    },
                  },
                ],
              },
              timelineItems: {
                nodes: [
                  {
                    __typename: "ReviewRequestedEvent",
                    createdAt: "2024-04-02T10:00:00.000Z",
                    requestedReviewer: {
                      __typename: "User",
                      id: "reviewer-1",
                    },
                  },
                ],
              },
            },
          },
        };
      }

      throw new Error("Unexpected query");
    });

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(requestMock).toHaveBeenCalledWith(
      pullRequestMetadataByNumberQuery,
      expect.objectContaining({ owner: "acme", name: "repo", number: 42 }),
    );
    expect(upsertPullRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pr-1",
        number: 42,
        repositoryId: "repo-1",
      }),
    );
    expect(upsertReviewRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rr-1",
        pullRequestId: "pr-1",
        reviewerId: "reviewer-1",
      }),
    );
  });

  it("continues sync when pull request retry returns null", async () => {
    listExistingPullRequestIdsMock.mockResolvedValue(new Set());

    const requestMock = createRequestMockForOpenPullRequestMetadata({
      openPullRequests: {
        nodes: [
          {
            id: "pr-1",
            number: 42,
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      pullRequestMetadataByNumber: async () => ({
        repository: { pullRequest: null },
      }),
    });

    await expect(
      runCollection({
        org: "acme",
        client: { request: requestMock } as unknown as GraphQLClient,
      }),
    ).resolves.toBeDefined();

    expect(upsertPullRequestMock).not.toHaveBeenCalled();
    expect(upsertReviewRequestMock).not.toHaveBeenCalled();
  });

  it("skips retry when pull request id mismatches the expected id", async () => {
    listExistingPullRequestIdsMock.mockResolvedValue(new Set());
    const logger = vi.fn();
    const requestMock = createRequestMockForOpenPullRequestMetadata({
      openPullRequests: {
        nodes: [
          {
            id: "pr-1",
            number: 42,
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      pullRequestMetadataByNumber: async () => ({
        repository: {
          pullRequest: {
            id: "pr-2",
            number: 42,
            title: "Mismatched PR",
            state: "OPEN",
            createdAt: "2024-04-01T10:00:00.000Z",
            updatedAt: "2024-04-02T10:00:00.000Z",
            closedAt: null,
            merged: false,
            mergedAt: null,
            author: null,
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        },
      }),
    });

    await runCollection({
      org: "acme",
      logger,
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(upsertPullRequestMock).not.toHaveBeenCalled();
    expect(upsertReviewRequestMock).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("Skipping retry for acme/repo#42"),
    );
  });

  it("logs retry failures and keeps the sync run successful", async () => {
    listExistingPullRequestIdsMock.mockResolvedValue(new Set());
    const logger = vi.fn();
    const requestMock = createRequestMockForOpenPullRequestMetadata({
      openPullRequests: {
        nodes: [
          {
            id: "pr-1",
            number: 42,
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      pullRequestMetadataByNumber: async () => {
        throw new Error("network boom");
      },
    });

    await runCollection({
      org: "acme",
      logger,
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed retrying review request sync for acme/repo#42: network boom",
      ),
    );
  });

  it("retries multiple missing pull requests in one run", async () => {
    listExistingPullRequestIdsMock.mockResolvedValue(new Set());

    const requestMock = createRequestMockForOpenPullRequestMetadata({
      openPullRequests: {
        nodes: [
          {
            id: "pr-1",
            number: 41,
            assignees: { nodes: [] },
            reviewRequests: {
              nodes: [
                {
                  id: "rr-1",
                  requestedReviewer: {
                    __typename: "User",
                    id: "reviewer-1",
                    login: "reviewer-1",
                    name: "Reviewer 1",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                  },
                },
              ],
            },
            timelineItems: {
              nodes: [
                {
                  __typename: "ReviewRequestedEvent",
                  createdAt: "2024-04-02T10:00:00.000Z",
                  requestedReviewer: {
                    __typename: "User",
                    id: "reviewer-1",
                  },
                },
              ],
            },
          },
          {
            id: "pr-2",
            number: 42,
            assignees: { nodes: [] },
            reviewRequests: {
              nodes: [
                {
                  id: "rr-2",
                  requestedReviewer: {
                    __typename: "User",
                    id: "reviewer-2",
                    login: "reviewer-2",
                    name: "Reviewer 2",
                    avatarUrl: null,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                  },
                },
              ],
            },
            timelineItems: {
              nodes: [
                {
                  __typename: "ReviewRequestedEvent",
                  createdAt: "2024-04-02T11:00:00.000Z",
                  requestedReviewer: {
                    __typename: "User",
                    id: "reviewer-2",
                  },
                },
              ],
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      pullRequestMetadataByNumber: async (variables) => {
        if (variables.number === 41) {
          return {
            repository: {
              pullRequest: {
                id: "pr-1",
                number: 41,
                title: "PR 41",
                state: "OPEN",
                createdAt: "2024-04-01T10:00:00.000Z",
                updatedAt: "2024-04-02T10:00:00.000Z",
                closedAt: null,
                merged: false,
                mergedAt: null,
                author: null,
                assignees: { nodes: [] },
                reviewRequests: {
                  nodes: [
                    {
                      id: "rr-1",
                      requestedReviewer: {
                        __typename: "User",
                        id: "reviewer-1",
                        login: "reviewer-1",
                        name: "Reviewer 1",
                        avatarUrl: null,
                        createdAt: "2024-01-01T00:00:00.000Z",
                        updatedAt: "2024-01-01T00:00:00.000Z",
                      },
                    },
                  ],
                },
                timelineItems: {
                  nodes: [
                    {
                      __typename: "ReviewRequestedEvent",
                      createdAt: "2024-04-02T10:00:00.000Z",
                      requestedReviewer: {
                        __typename: "User",
                        id: "reviewer-1",
                      },
                    },
                  ],
                },
              },
            },
          };
        }

        if (variables.number === 42) {
          return {
            repository: {
              pullRequest: {
                id: "pr-2",
                number: 42,
                title: "PR 42",
                state: "OPEN",
                createdAt: "2024-04-01T11:00:00.000Z",
                updatedAt: "2024-04-02T11:00:00.000Z",
                closedAt: null,
                merged: false,
                mergedAt: null,
                author: null,
                assignees: { nodes: [] },
                reviewRequests: {
                  nodes: [
                    {
                      id: "rr-2",
                      requestedReviewer: {
                        __typename: "User",
                        id: "reviewer-2",
                        login: "reviewer-2",
                        name: "Reviewer 2",
                        avatarUrl: null,
                        createdAt: "2024-01-01T00:00:00.000Z",
                        updatedAt: "2024-01-01T00:00:00.000Z",
                      },
                    },
                  ],
                },
                timelineItems: {
                  nodes: [
                    {
                      __typename: "ReviewRequestedEvent",
                      createdAt: "2024-04-02T11:00:00.000Z",
                      requestedReviewer: {
                        __typename: "User",
                        id: "reviewer-2",
                      },
                    },
                  ],
                },
              },
            },
          };
        }

        throw new Error("Unexpected pull request number");
      },
    });

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(upsertPullRequestMock).toHaveBeenCalledTimes(2);
    expect(upsertReviewRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rr-1", pullRequestId: "pr-1" }),
    );
    expect(upsertReviewRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rr-2", pullRequestId: "pr-2" }),
    );
  });

  it("handles mixed existing and missing pull requests across metadata pages", async () => {
    listExistingPullRequestIdsMock.mockImplementation(
      async (ids: readonly string[]) =>
        new Set(ids.filter((id) => id !== "pr-missing")),
    );

    const requestMock = vi.fn(
      async (document: unknown, variables: TestQueryVariables = {}) => {
        if (document === organizationRepositoriesQuery) {
          return {
            organization: {
              repositories: {
                nodes: [
                  {
                    id: "repo-1",
                    name: "repo",
                    nameWithOwner: "acme/repo",
                    url: "https://github.com/acme/repo",
                    isPrivate: false,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-04-02T12:00:00.000Z",
                    owner: {
                      id: "owner-1",
                      login: "owner",
                      name: "Owner",
                      avatarUrl: null,
                      createdAt: "2024-01-01T00:00:00.000Z",
                      updatedAt: "2024-01-01T00:00:00.000Z",
                      __typename: "User",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        }
        if (document === repositoryIssuesQuery) {
          return { repository: { issues: emptyConnection } };
        }
        if (document === repositoryDiscussionsQuery) {
          return { repository: { discussions: emptyConnection } };
        }
        if (document === repositoryPullRequestsQuery) {
          return { repository: { pullRequests: emptyConnection } };
        }
        if (document === issueCommentsQuery) {
          return { repository: { issue: { comments: emptyConnection } } };
        }
        if (document === discussionCommentsQuery) {
          return {
            repository: { discussion: { comments: emptyConnection } },
          };
        }
        if (document === pullRequestCommentsQuery) {
          return { repository: { pullRequest: { comments: emptyConnection } } };
        }
        if (document === pullRequestReviewsQuery) {
          return { repository: { pullRequest: { reviews: emptyConnection } } };
        }
        if (document === pullRequestReviewCommentsQuery) {
          return {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          };
        }
        if (document === openIssueMetadataQuery) {
          return { repository: { issues: emptyConnection } };
        }
        if (document === openPullRequestMetadataQuery) {
          if (!variables.cursor) {
            return {
              repository: {
                pullRequests: {
                  nodes: [
                    {
                      id: "pr-existing",
                      number: 41,
                      assignees: { nodes: [] },
                      reviewRequests: {
                        nodes: [
                          {
                            id: "rr-existing",
                            requestedReviewer: {
                              __typename: "User",
                              id: "reviewer-existing",
                              login: "reviewer-existing",
                              name: "Reviewer Existing",
                              avatarUrl: null,
                              createdAt: "2024-01-01T00:00:00.000Z",
                              updatedAt: "2024-01-01T00:00:00.000Z",
                            },
                          },
                        ],
                      },
                      timelineItems: {
                        nodes: [
                          {
                            __typename: "ReviewRequestedEvent",
                            createdAt: "2024-04-02T10:00:00.000Z",
                            requestedReviewer: {
                              __typename: "User",
                              id: "reviewer-existing",
                            },
                          },
                        ],
                      },
                    },
                    {
                      id: "pr-missing",
                      number: 42,
                      assignees: { nodes: [] },
                      reviewRequests: {
                        nodes: [
                          {
                            id: "rr-missing",
                            requestedReviewer: {
                              __typename: "User",
                              id: "reviewer-missing",
                              login: "reviewer-missing",
                              name: "Reviewer Missing",
                              avatarUrl: null,
                              createdAt: "2024-01-01T00:00:00.000Z",
                              updatedAt: "2024-01-01T00:00:00.000Z",
                            },
                          },
                        ],
                      },
                      timelineItems: {
                        nodes: [
                          {
                            __typename: "ReviewRequestedEvent",
                            createdAt: "2024-04-02T10:05:00.000Z",
                            requestedReviewer: {
                              __typename: "User",
                              id: "reviewer-missing",
                            },
                          },
                        ],
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
                },
              },
            };
          }
          return {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    id: "pr-page2",
                    number: 43,
                    assignees: { nodes: [] },
                    reviewRequests: { nodes: [] },
                    timelineItems: { nodes: [] },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        }
        if (document === pullRequestMetadataByNumberQuery) {
          return {
            repository: {
              pullRequest: {
                id: "pr-missing",
                number: 42,
                title: "Recovered PR",
                state: "OPEN",
                createdAt: "2024-04-01T10:00:00.000Z",
                updatedAt: "2024-04-02T10:05:00.000Z",
                closedAt: null,
                merged: false,
                mergedAt: null,
                author: null,
                assignees: { nodes: [] },
                reviewRequests: {
                  nodes: [
                    {
                      id: "rr-missing",
                      requestedReviewer: {
                        __typename: "User",
                        id: "reviewer-missing",
                        login: "reviewer-missing",
                        name: "Reviewer Missing",
                        avatarUrl: null,
                        createdAt: "2024-01-01T00:00:00.000Z",
                        updatedAt: "2024-01-01T00:00:00.000Z",
                      },
                    },
                  ],
                },
                timelineItems: {
                  nodes: [
                    {
                      __typename: "ReviewRequestedEvent",
                      createdAt: "2024-04-02T10:05:00.000Z",
                      requestedReviewer: {
                        __typename: "User",
                        id: "reviewer-missing",
                      },
                    },
                  ],
                },
              },
            },
          };
        }
        throw new Error("Unexpected query");
      },
    );

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(requestMock).toHaveBeenCalledWith(
      openPullRequestMetadataQuery,
      expect.objectContaining({ cursor: null }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      openPullRequestMetadataQuery,
      expect.objectContaining({ cursor: "cursor-2" }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      pullRequestMetadataByNumberQuery,
      expect.objectContaining({ number: 42 }),
    );
    expect(upsertReviewRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rr-existing",
        pullRequestId: "pr-existing",
      }),
    );
    expect(upsertReviewRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rr-missing",
        pullRequestId: "pr-missing",
      }),
    );
  });

  it("applies pending review request removals during retry sync", async () => {
    listExistingPullRequestIdsMock.mockResolvedValue(new Set());
    listPendingReviewRequestsMock.mockResolvedValue(
      new Map([
        [
          "pr-1",
          [
            {
              id: "pending-1",
              pullRequestId: "pr-1",
              reviewerId: "reviewer-1",
              requestedAt: "2024-04-01T00:00:00.000Z",
            },
          ],
        ],
      ]),
    );

    const requestMock = createRequestMockForOpenPullRequestMetadata({
      openPullRequests: {
        nodes: [
          {
            id: "pr-1",
            number: 42,
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      pullRequestMetadataByNumber: async () => ({
        repository: {
          pullRequest: {
            id: "pr-1",
            number: 42,
            title: "PR title",
            state: "OPEN",
            createdAt: "2024-04-01T10:00:00.000Z",
            updatedAt: "2024-04-02T10:00:00.000Z",
            closedAt: null,
            merged: false,
            mergedAt: null,
            author: null,
            assignees: { nodes: [] },
            reviewRequests: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        },
      }),
    });

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    expect(markReviewRequestRemovedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: "pr-1",
        reviewerId: "reviewer-1",
      }),
    );
  });

  it("propagates recordSyncLog failures", async () => {
    recordSyncLogMock.mockImplementationOnce(async () => {
      throw new Error("log failure");
    });

    await expect(
      runCollection({
        org: "acme",
        client: {
          request: vi.fn(async (document: unknown) => {
            if (document === organizationRepositoriesQuery) {
              return {
                organization: {
                  repositories: emptyConnection,
                },
              };
            }
            if (document === repositoryIssuesQuery) {
              return { repository: { issues: emptyConnection } };
            }
            if (document === repositoryPullRequestsQuery) {
              return { repository: { pullRequests: emptyConnection } };
            }
            if (document === issueCommentsQuery) {
              return { repository: { issue: { comments: emptyConnection } } };
            }
            if (document === pullRequestCommentsQuery) {
              return {
                repository: { pullRequest: { comments: emptyConnection } },
              };
            }
            if (document === pullRequestReviewsQuery) {
              return {
                repository: { pullRequest: { reviews: emptyConnection } },
              };
            }
            if (document === pullRequestReviewCommentsQuery) {
              return {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              };
            }
            if (document === openIssueMetadataQuery) {
              return { repository: { issues: emptyConnection } };
            }
            if (document === openPullRequestMetadataQuery) {
              return { repository: { pullRequests: emptyConnection } };
            }
            throw new Error("Unexpected query");
          }),
        } as unknown as GraphQLClient,
      }),
    ).rejects.toThrow("log failure");

    expect(updateSyncLogMock).not.toHaveBeenCalled();
  });
});
