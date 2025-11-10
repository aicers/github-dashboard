import type { GraphQLClient } from "graphql-request";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realignRepositoryMismatches } from "@/lib/github/repository-realignment";

const {
  queryMock,
  withTransactionMock,
  upsertRepositoryMock,
  upsertUserMock,
  upsertIssueMock,
  refreshSnapshotMock,
  refreshCachesMock,
} = vi.hoisted(() => {
  return {
    queryMock: vi.fn(),
    withTransactionMock: vi.fn(),
    upsertRepositoryMock: vi.fn(async () => {}),
    upsertUserMock: vi.fn(async () => {}),
    upsertIssueMock: vi.fn(async () => {}),
    refreshSnapshotMock: vi.fn(async () => {}),
    refreshCachesMock: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/db/client", () => ({
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  withTransaction: (...args: Parameters<typeof withTransactionMock>) =>
    withTransactionMock(...args),
}));

vi.mock("@/lib/db/operations", () => ({
  upsertRepository: (...args: Parameters<typeof upsertRepositoryMock>) =>
    upsertRepositoryMock(...args),
  upsertUser: (...args: Parameters<typeof upsertUserMock>) =>
    upsertUserMock(...args),
  upsertIssue: (...args: Parameters<typeof upsertIssueMock>) =>
    upsertIssueMock(...args),
}));

vi.mock("@/lib/activity/snapshot", () => ({
  refreshActivityItemsSnapshot: (
    ...args: Parameters<typeof refreshSnapshotMock>
  ) => refreshSnapshotMock(...args),
}));

vi.mock("@/lib/activity/cache", () => ({
  refreshActivityCaches: (...args: Parameters<typeof refreshCachesMock>) =>
    refreshCachesMock(...args),
}));

vi.mock("@/lib/github/client", () => ({
  createGithubClient: vi.fn(() => {
    throw new Error("createGithubClient should not be called in tests");
  }),
}));

const rateLimit = {
  cost: 1,
  remaining: 5000,
  resetAt: new Date().toISOString(),
};

function buildIssueNode(overrides?: Partial<Record<string, unknown>>) {
  return {
    __typename: "Issue",
    id: "I_kwABC123",
    number: 504,
    title: "Example",
    state: "OPEN",
    url: "https://github.com/aicers/patio/issues/504",
    body: "body",
    bodyText: "body",
    bodyHTML: "<p>body</p>",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    closedAt: null,
    author: {
      __typename: "User",
      id: "U_kwABC",
      login: "alice",
      name: "Alice",
      avatarUrl: "https://avatars.example/alice",
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    participants: { nodes: [] },
    labels: { nodes: [{ id: "lbl", name: "bug", color: "ff0000" }] },
    comments: { totalCount: 3 },
    assignees: { nodes: [] },
    trackedIssues: {
      totalCount: 1,
      nodes: [
        {
          id: "I_child",
          number: 1,
          title: "child",
          url: "#",
          state: "OPEN",
          repository: { nameWithOwner: "aicers/patio" },
        },
      ],
    },
    trackedInIssues: {
      totalCount: 0,
      nodes: [],
    },
    issueType: { id: "it", name: "Task" },
    milestone: { id: "m1", title: "v1", state: "OPEN", dueOn: null, url: "#" },
    timelineItems: { nodes: [] },
    projectItems: {
      nodes: [
        {
          id: "PVTI_1",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
          project: { title: "to-do" },
          status: {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            name: "Todo",
            updatedAt: "2025-01-02T00:00:00Z",
          },
          priority: {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            name: "P1",
            updatedAt: "2025-01-02T00:00:00Z",
          },
          initiationOptions: null,
          startDate: null,
        },
      ],
    },
    reactions: {
      nodes: [
        {
          id: "R1",
          content: "THUMBS_UP",
          createdAt: "2025-01-02T00:00:00Z",
          user: {
            id: "U_kwABC",
            login: "alice",
            name: "Alice",
            avatarUrl: "https://avatars.example/alice",
          },
        },
      ],
    },
    repository: {
      id: "R_repo_new",
      name: "patio",
      nameWithOwner: "aicers/patio",
      url: "https://github.com/aicers/patio",
      isPrivate: false,
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      owner: {
        __typename: "Organization",
        id: "ORG",
        login: "aicers",
        name: "aicers",
        avatarUrl: "https://avatars.example/org",
        createdAt: "2010-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    },
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

describe("realignRepositoryMismatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
    withTransactionMock.mockReset();
    withTransactionMock.mockImplementation(async (handler) =>
      handler({
        query: vi.fn(async () => ({ rows: [] })),
      }),
    );
    globalThis.fetch = undefined as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("upserts the full issue payload when repository mismatch is detected", async () => {
    const candidateRow = {
      id: "I_kwABC123",
      repository_id: "R_repo_old",
      stored_repo: "aicers/aice-web",
      url: "https://github.com/aicers/aice-web/issues/1755",
      ownership_checked_at: null,
      project_item_ids: ["PVTI_1"],
      ui_mismatch: true,
    };

    queryMock
      .mockResolvedValueOnce({ rows: [candidateRow] })
      .mockResolvedValueOnce({ rows: [] });

    const issueNode = buildIssueNode();

    const client = {
      request: vi.fn(
        async (_document: unknown, variables: Record<string, unknown>) => {
          if ("ids" in variables) {
            expect(variables.ids).toEqual([candidateRow.id]);
            return { nodes: [issueNode], rateLimit };
          }
          throw new Error("Unexpected GraphQL query");
        },
      ),
    } as unknown as GraphQLClient;

    const summary = await realignRepositoryMismatches({
      client,
      limit: 50,
      chunkSize: 10,
      dryRun: false,
      refreshArtifacts: false,
    });

    expect(summary).toEqual({ candidates: 1, updated: 1, dryRun: false });
    expect(upsertRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "R_repo_new",
        nameWithOwner: "aicers/patio",
      }),
    );
    expect(upsertUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "U_kwABC" }),
    );
    expect(upsertIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: issueNode.id,
        repositoryId: "R_repo_new",
        raw: expect.objectContaining({
          projectItems: expect.any(Object),
          trackedIssues: expect.any(Object),
        }),
      }),
    );
    const updateArgs = queryMock.mock.calls[1];
    expect(updateArgs?.[1]).toEqual([[candidateRow.id]]);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("migrates issue identity when GitHub returns a different node id", async () => {
    const candidateRow = {
      id: "I_kwOLD",
      repository_id: "R_repo_old",
      stored_repo: "aicers/aice-web",
      url: "https://github.com/aicers/aice-web/issues/1755",
      ownership_checked_at: null,
      project_item_ids: ["PVTI_1"],
      ui_mismatch: true,
    };

    queryMock
      .mockResolvedValueOnce({ rows: [candidateRow] })
      .mockResolvedValueOnce({ rows: [] });

    const migratedNode = buildIssueNode({ id: "I_kwNEW" });

    const transactionQuery = vi.fn(async () => ({ rows: [] }));
    withTransactionMock.mockImplementation(async (handler) =>
      handler({ query: transactionQuery } as never),
    );

    const client = {
      request: vi.fn(
        async (_document: unknown, variables: Record<string, unknown>) => {
          if ("ids" in variables) {
            const id = (variables.ids as string[])[0];
            if (id === candidateRow.id) {
              return { nodes: [null], rateLimit };
            }
            if (id === migratedNode.id) {
              return { nodes: [migratedNode], rateLimit };
            }
          }
          if ("url" in variables) {
            return { resource: { __typename: "Issue", id: migratedNode.id } };
          }
          throw new Error("Unexpected GraphQL query");
        },
      ),
    } as unknown as GraphQLClient;

    const summary = await realignRepositoryMismatches({
      client,
      limit: 10,
      chunkSize: 5,
      dryRun: false,
      refreshArtifacts: false,
    });

    expect(summary).toEqual({ candidates: 1, updated: 1, dryRun: false });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE issues SET id = $2 WHERE id = $1"),
      [candidateRow.id, migratedNode.id],
    );
    const updateArgs = queryMock.mock.calls[1];
    expect(updateArgs?.[1]).toEqual([[candidateRow.id, migratedNode.id]]);
    expect(upsertIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: migratedNode.id,
        repositoryId: "R_repo_new",
      }),
    );
  });
});
