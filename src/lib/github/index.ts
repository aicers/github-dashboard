import { createGithubClient } from "@/lib/github/client";
import { repositorySummaryQuery, viewerQuery } from "@/lib/github/queries";

type ViewerQueryResult = {
  viewer: {
    login: string;
    name: string | null;
    url: string;
  };
  rateLimit: {
    remaining: number;
    resetAt: string;
  };
};

type RepositorySummaryResult = {
  repository: {
    name: string;
    description: string | null;
    url: string;
    stargazerCount: number;
    forkCount: number;
    issues: {
      totalCount: number;
    };
    pullRequests: {
      totalCount: number;
    };
    defaultBranchRef: {
      name: string;
    } | null;
    updatedAt: string;
  } | null;
};

export type ViewerSummary = {
  login: string;
  name: string | null;
  url: string;
  remainingRequests: number;
  resetAt: string;
};

export type RepositorySummary = {
  name: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  openIssues: number;
  openPullRequests: number;
  defaultBranch: string;
  updatedAt: string;
};

export async function fetchViewerSummary(): Promise<ViewerSummary> {
  const client = createGithubClient();
  const { viewer, rateLimit } =
    await client.request<ViewerQueryResult>(viewerQuery);

  return {
    login: viewer.login,
    name: viewer.name,
    url: viewer.url,
    remainingRequests: rateLimit.remaining,
    resetAt: rateLimit.resetAt,
  };
}

export async function fetchRepositorySummary(
  owner: string,
  name: string,
): Promise<RepositorySummary> {
  const client = createGithubClient();
  const result = await client.request<RepositorySummaryResult>(
    repositorySummaryQuery,
    {
      owner,
      name,
    },
  );
  const repository = result.repository;

  if (!repository) {
    throw new Error(`Repository ${owner}/${name} was not found.`);
  }

  return {
    name: repository.name,
    description: repository.description,
    url: repository.url,
    stars: repository.stargazerCount,
    forks: repository.forkCount,
    openIssues: repository.issues.totalCount,
    openPullRequests: repository.pullRequests.totalCount,
    defaultBranch: repository.defaultBranchRef?.name ?? "main",
    updatedAt: repository.updatedAt,
  };
}
