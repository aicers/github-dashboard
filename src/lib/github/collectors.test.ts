import type { GraphQLClient } from "graphql-request";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGithubClient } from "@/lib/github/client";
import { runCollection } from "@/lib/github/collectors";
import { organizationRepositoriesQuery } from "@/lib/github/queries";

vi.mock("@/lib/db/operations", () => {
  const asyncNoop = vi.fn(async () => {});
  const logIdSequence = { value: 0 };
  return {
    recordSyncLog: vi.fn(async () => {
      logIdSequence.value += 1;
      return logIdSequence.value;
    }),
    updateSyncLog: vi.fn(async () => {}),
    updateSyncState: vi.fn(async () => {}),
    upsertRepository: asyncNoop,
    upsertUser: asyncNoop,
    upsertIssue: asyncNoop,
    upsertPullRequest: asyncNoop,
    upsertReview: asyncNoop,
    upsertReviewRequest: asyncNoop,
    upsertComment: asyncNoop,
    upsertReaction: asyncNoop,
    markReviewRequestRemoved: asyncNoop,
    fetchIssueRawMap: vi.fn(async () => new Map()),
    reviewExists: vi.fn(async () => false),
  };
});

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
});
