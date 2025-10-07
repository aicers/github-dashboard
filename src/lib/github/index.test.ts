import type { GraphQLClient } from "graphql-request";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRepositorySummary, fetchViewerSummary } from "@/lib/github";

const { createGithubClientMock } = vi.hoisted(() => ({
  createGithubClientMock: vi.fn<() => GraphQLClient>(),
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

afterEach(() => {
  vi.clearAllMocks();
  createGithubClientMock.mockReset();
});

describe("fetchViewerSummary", () => {
  it("returns normalized viewer data", async () => {
    const request = createClientMock();
    request.mockResolvedValueOnce({
      viewer: {
        login: "octocat",
        name: "The Octocat",
        url: "https://github.com/octocat",
      },
      rateLimit: {
        remaining: 1234,
        resetAt: "2024-05-01T00:00:00.000Z",
      },
    });

    const summary = await fetchViewerSummary();

    expect(summary).toEqual({
      login: "octocat",
      name: "The Octocat",
      url: "https://github.com/octocat",
      remainingRequests: 1234,
      resetAt: "2024-05-01T00:00:00.000Z",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("fetchRepositorySummary", () => {
  it("maps repository fields to the summary format", async () => {
    const request = createClientMock();
    request.mockResolvedValueOnce({
      repository: {
        name: "playwright",
        description: "Testing",
        url: "https://github.com/microsoft/playwright",
        stargazerCount: 123,
        forkCount: 45,
        issues: { totalCount: 6 },
        pullRequests: { totalCount: 7 },
        defaultBranchRef: { name: "main" },
        updatedAt: "2024-04-01T12:00:00.000Z",
      },
    });

    const summary = await fetchRepositorySummary("microsoft", "playwright");

    expect(summary).toEqual({
      name: "playwright",
      description: "Testing",
      url: "https://github.com/microsoft/playwright",
      stars: 123,
      forks: 45,
      openIssues: 6,
      openPullRequests: 7,
      defaultBranch: "main",
      updatedAt: "2024-04-01T12:00:00.000Z",
    });
    expect(request).toHaveBeenCalledWith(expect.anything(), {
      owner: "microsoft",
      name: "playwright",
    });
  });

  it("throws when the repository is not found", async () => {
    const request = createClientMock();
    request.mockResolvedValueOnce({ repository: null });

    await expect(fetchRepositorySummary("acme", "missing")).rejects.toThrow(
      "Repository acme/missing was not found.",
    );
  });
});
