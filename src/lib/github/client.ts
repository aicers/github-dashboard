import { GraphQLClient } from "graphql-request";

import { env } from "@/lib/env";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

export function createGithubClient(token = env.GITHUB_TOKEN) {
  if (!token) {
    throw new Error(
      "GitHub token missing. Set GITHUB_TOKEN in your environment to enable API access.",
    );
  }

  return new GraphQLClient(GITHUB_GRAPHQL_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
