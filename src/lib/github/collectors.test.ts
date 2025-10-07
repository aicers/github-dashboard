import { GraphQLError } from "graphql";
import type { GraphQLClient } from "graphql-request";
import { ClientError } from "graphql-request";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGithubClient } from "@/lib/github/client";
import { runCollection } from "@/lib/github/collectors";
import {
  issueCommentsQuery,
  organizationRepositoriesQuery,
  pullRequestCommentsQuery,
  pullRequestReviewCommentsQuery,
  pullRequestReviewsQuery,
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
  upsertReviewMock,
  upsertReviewRequestMock,
  upsertCommentMock,
  upsertReactionMock,
  markReviewRequestRemovedMock,
  fetchIssueRawMapMock,
  reviewExistsMock,
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
    upsertReviewMock: vi.fn(async () => {}),
    upsertReviewRequestMock: vi.fn(async () => {}),
    upsertCommentMock: vi.fn(async () => {}),
    upsertReactionMock: vi.fn(async () => {}),
    markReviewRequestRemovedMock: vi.fn(async () => {}),
    fetchIssueRawMapMock: vi.fn(async () => new Map()),
    reviewExistsMock: vi.fn(async () => false),
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

describe("runCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLogSequence();
    recordSyncLogMock.mockImplementation(async () => nextLogId());
    fetchIssueRawMapMock.mockImplementation(async () => new Map());
    reviewExistsMock.mockResolvedValue(false);
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
      counts: { issues: 0, pullRequests: 0, reviews: 0, comments: 0 },
      timestamps: {
        repositories: null,
        issues: null,
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

        if (document === repositoryPullRequestsQuery) {
          return { repository: { pullRequests: emptyConnection } };
        }

        if (document === issueCommentsQuery) {
          return { repository: { issue: { comments: emptyConnection } } };
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

      if (document === issueCommentsQuery) {
        return {
          repository: {
            issue: {
              comments: commentConnection,
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
        },
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

      if (document === repositoryPullRequestsQuery) {
        return { repository: { pullRequests: emptyConnection } };
      }

      if (document === issueCommentsQuery) {
        return { repository: { issue: { comments: emptyConnection } } };
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
            throw new Error("Unexpected query");
          }),
        } as unknown as GraphQLClient,
      }),
    ).rejects.toThrow("log failure");

    expect(updateSyncLogMock).not.toHaveBeenCalled();
  });
});
