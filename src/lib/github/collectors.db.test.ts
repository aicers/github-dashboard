// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import type { GraphQLClient } from "graphql-request";
import { beforeEach, describe, expect, it } from "vitest";

import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { runCollection } from "@/lib/github/collectors";
import {
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
import { resetDashboardAndSyncTables } from "../../../tests/helpers/dashboard-metrics";

const emptyConnection = {
  nodes: [],
  pageInfo: { hasNextPage: false, endCursor: null },
} as const;

describe("collectors database integration", () => {
  beforeEach(async () => {
    await ensureSchema();
    await resetDashboardAndSyncTables();
  });

  it("recovers missing pull_requests within the same run and persists review_requests", async () => {
    const requestMock = async (document: unknown) => {
      if (document === organizationRepositoriesQuery) {
        return {
          organization: {
            repositories: {
              nodes: [
                {
                  id: "repo-db-1",
                  name: "repo",
                  nameWithOwner: "acme/repo",
                  url: "https://github.com/acme/repo",
                  isPrivate: false,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-04-02T12:00:00.000Z",
                  owner: {
                    id: "owner-db-1",
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
        return { repository: { discussion: { comments: emptyConnection } } };
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
                  id: "pr-db-1",
                  number: 42,
                  assignees: { nodes: [] },
                  reviewRequests: {
                    nodes: [
                      {
                        id: "rr-db-1",
                        requestedReviewer: {
                          __typename: "User",
                          id: "reviewer-db-1",
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
                          id: "reviewer-db-1",
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
              id: "pr-db-1",
              number: 42,
              title: "Recovered PR",
              state: "OPEN",
              createdAt: "2024-04-01T10:00:00.000Z",
              updatedAt: "2024-04-02T10:00:00.000Z",
              closedAt: null,
              merged: false,
              mergedAt: null,
              author: {
                __typename: "User",
                id: "author-db-1",
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
                    id: "rr-db-1",
                    requestedReviewer: {
                      __typename: "User",
                      id: "reviewer-db-1",
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
                      id: "reviewer-db-1",
                    },
                  },
                ],
              },
            },
          },
        };
      }

      throw new Error("Unexpected query");
    };

    await runCollection({
      org: "acme",
      client: { request: requestMock } as unknown as GraphQLClient,
    });

    const prResult = await query<{ id: string; number: number }>(
      "SELECT id, number FROM pull_requests WHERE id = $1",
      ["pr-db-1"],
    );
    expect(prResult.rowCount).toBe(1);
    expect(prResult.rows[0]).toEqual({ id: "pr-db-1", number: 42 });

    const reviewRequestResult = await query<{
      id: string;
      pull_request_id: string;
      reviewer_id: string | null;
    }>(
      "SELECT id, pull_request_id, reviewer_id FROM review_requests WHERE id = $1",
      ["rr-db-1"],
    );
    expect(reviewRequestResult.rowCount).toBe(1);
    expect(reviewRequestResult.rows[0]).toEqual({
      id: "rr-db-1",
      pull_request_id: "pr-db-1",
      reviewer_id: "reviewer-db-1",
    });
  });
});
