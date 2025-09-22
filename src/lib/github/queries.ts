import { gql } from "graphql-request";

export const viewerQuery = gql`
  query ViewerQuery {
    viewer {
      login
      name
      url
    }
    rateLimit {
      remaining
      resetAt
    }
  }
`;

export const repositorySummaryQuery = gql`
  query RepositorySummary($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      description
      url
      stargazerCount
      forkCount
      issues(states: OPEN) {
        totalCount
      }
      pullRequests(states: OPEN) {
        totalCount
      }
      defaultBranchRef {
        name
      }
      updatedAt
    }
  }
`;
