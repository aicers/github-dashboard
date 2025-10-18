"use server";

import { env } from "@/lib/env";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_PAGE_SIZE = 100;

class GithubRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GithubRequestError";
    this.status = status;
  }
}

type GithubTeamResponse = {
  id: number;
  node_id?: string;
  slug: string;
  name: string;
  description?: string | null;
};

type GithubMemberResponse = {
  id: number;
  node_id?: string;
  login: string;
  avatar_url?: string | null;
};

export type GithubTeamSummary = {
  id: number;
  nodeId: string | null;
  slug: string;
  name: string;
};

export type GithubMemberSummary = {
  id: number;
  nodeId: string | null;
  login: string;
  avatarUrl: string | null;
};

type FetchOptions = {
  token?: string | null;
};

function resolveGithubToken(explicit?: string | null) {
  const token = (explicit ?? env.GITHUB_TOKEN ?? "").trim();
  return token.length > 0 ? token : null;
}

async function fetchPaginated<T>(
  path: string,
  token: string,
  perPage = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const url = `${GITHUB_API_BASE}${path}?per_page=${perPage}&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "github-dashboard/org-fetcher",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new GithubRequestError(
        response.status,
        `Failed to load ${path}. GitHub responded with ${response.status}.`,
      );
    }

    const chunk = (await response.json()) as T[];
    results.push(...chunk);

    if (chunk.length < perPage) {
      break;
    }

    page += 1;
  }

  return results;
}

export async function fetchOrganizationTeams(
  org: string,
  options?: FetchOptions,
): Promise<GithubTeamSummary[]> {
  const trimmedOrg = org.trim();
  if (!trimmedOrg) {
    return [];
  }

  const token = resolveGithubToken(options?.token);
  if (!token) {
    console.warn(
      "[github-dashboard] Skipping GitHub team fetch: no token with read:org scope is configured.",
    );
    return [];
  }

  try {
    const teams = await fetchPaginated<GithubTeamResponse>(
      `/orgs/${encodeURIComponent(trimmedOrg)}/teams`,
      token,
    );

    return teams.map((team) => ({
      id: team.id,
      nodeId: team.node_id ?? null,
      slug: team.slug,
      name: team.name,
    }));
  } catch (error) {
    if (
      error instanceof GithubRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      console.warn(
        `[github-dashboard] GitHub denied access to /orgs/${trimmedOrg}/teams (status ${error.status}). Ensure the configured token grants read:org.`,
      );
      return [];
    }

    throw error;
  }
}

export async function fetchOrganizationMembers(
  org: string,
  options?: FetchOptions,
): Promise<GithubMemberSummary[]> {
  const trimmedOrg = org.trim();
  if (!trimmedOrg) {
    return [];
  }

  const token = resolveGithubToken(options?.token);
  if (!token) {
    console.warn(
      "[github-dashboard] Skipping GitHub member fetch: no token with read:org scope is configured.",
    );
    return [];
  }

  try {
    const members = await fetchPaginated<GithubMemberResponse>(
      `/orgs/${encodeURIComponent(trimmedOrg)}/members`,
      token,
    );

    return members.map((member) => ({
      id: member.id,
      nodeId: member.node_id ?? null,
      login: member.login,
      avatarUrl: member.avatar_url ?? null,
    }));
  } catch (error) {
    if (
      error instanceof GithubRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      console.warn(
        `[github-dashboard] GitHub denied access to /orgs/${trimmedOrg}/members (status ${error.status}). Ensure the configured token grants read:org.`,
      );
      return [];
    }

    throw error;
  }
}
