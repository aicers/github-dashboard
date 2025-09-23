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

export const organizationRepositoriesQuery = gql`
  query OrganizationRepositories($login: String!, $cursor: String) {
    organization(login: $login) {
      repositories(first: 50, after: $cursor, orderBy: { field: PUSHED_AT, direction: DESC }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          databaseId
          name
          nameWithOwner
          url
          isPrivate
          createdAt
          updatedAt
          owner {
            __typename
            ... on User {
              id
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
            ... on Organization {
              id
              name
              login
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
`;

export const repositoryIssuesQuery = gql`
  query RepositoryIssues($owner: String!, $name: String!, $cursor: String, $since: DateTime) {
    repository(owner: $owner, name: $name) {
      issues(first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: ASC }, filterBy: { since: $since }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          state
          url
          createdAt
          updatedAt
          closedAt
          author {
            __typename
            ... on User {
              id
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
            ... on Organization {
              id
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
            ... on Bot {
              id
              login
              avatarUrl(size: 200)
            }
          }
          participants(first: 10) {
            nodes {
              ... on User {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
            }
          }
          comments(first: 0) {
            totalCount
          }
        }
      }
    }
  }
`;

export const repositoryPullRequestsQuery = gql`
  query RepositoryPullRequests($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: ASC }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          number
          title
          state
          url
          createdAt
          updatedAt
          closedAt
          mergedAt
          isDraft
          merged
          additions
          deletions
          changedFiles
          reviewDecision
          author {
            __typename
            ... on User {
              id
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
            ... on Organization {
              id
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
            ... on Bot {
              id
              login
              avatarUrl(size: 200)
            }
          }
          comments(first: 0) {
            totalCount
          }
          reviews(first: 0) {
            totalCount
          }
        }
      }
    }
  }
`;

export const pullRequestReviewsQuery = gql`
  query PullRequestReviews($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviews(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            author {
              __typename
              ... on User {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
              ... on Organization {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
              ... on Bot {
                id
                login
                avatarUrl(size: 200)
              }
            }
            submittedAt
            state
            body
            url
          }
        }
      }
    }
  }
`;

export const issueCommentsQuery = gql`
  query IssueComments($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            author {
              __typename
              ... on User {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
              ... on Organization {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
              ... on Bot {
                id
                login
                avatarUrl(size: 200)
              }
            }
            createdAt
            updatedAt
            url
            body
          }
        }
      }
    }
  }
`;

export const pullRequestCommentsQuery = gql`
  query PullRequestComments($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        comments(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            author {
              __typename
              ... on User {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
              ... on Organization {
                id
                login
                name
                avatarUrl(size: 200)
                createdAt
                updatedAt
              }
              ... on Bot {
                id
                login
                avatarUrl(size: 200)
              }
            }
            createdAt
            updatedAt
            url
            body
          }
        }
      }
    }
  }
`;

export const pullRequestReviewCommentsQuery = gql`
  query PullRequestReviewComments($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 25, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            comments(first: 100) {
              nodes {
                id
                author {
                  __typename
                  ... on User {
                    id
                    login
                    name
                    avatarUrl(size: 200)
                    createdAt
                    updatedAt
                  }
                  ... on Organization {
                    id
                    login
                    name
                    avatarUrl(size: 200)
                    createdAt
                    updatedAt
                  }
                  ... on Bot {
                    id
                    login
                    avatarUrl(size: 200)
                  }
                }
                createdAt
                updatedAt
                url
                body
                pullRequestReview {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;
