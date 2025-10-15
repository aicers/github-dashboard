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
      repositories(first: 25, after: $cursor, orderBy: { field: PUSHED_AT, direction: DESC }) {
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
      issues(first: 25, after: $cursor, orderBy: { field: UPDATED_AT, direction: ASC }, filterBy: { since: $since }) {
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
          body
          bodyText
          bodyHTML
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
          labels(first: 50) {
            nodes {
              id
              name
              color
            }
          }
          comments(first: 0) {
            totalCount
          }
          trackedIssues(first: 10) {
            totalCount
            nodes {
              id
              number
              title
              url
              state
              repository {
                nameWithOwner
              }
            }
          }
          trackedInIssues(first: 10) {
            totalCount
            nodes {
              id
              number
              title
              url
              state
              repository {
                nameWithOwner
              }
            }
          }
          issueType {
            id
            name
          }
          milestone {
            id
            title
            state
            dueOn
            url
          }
          timelineItems(
            last: 25,
            itemTypes: [ADDED_TO_PROJECT_EVENT, MOVED_COLUMNS_IN_PROJECT_EVENT]
          ) {
            nodes {
              __typename
              ... on AddedToProjectEvent {
                createdAt
                projectColumnName
                project {
                  name
                }
              }
              ... on MovedColumnsInProjectEvent {
                createdAt
                projectColumnName
                previousProjectColumnName
                project {
                  name
                }
              }
            }
          }
          projectItems(first: 10) {
            nodes {
              id
              createdAt
              updatedAt
              project {
                title
              }
              status: fieldValueByName(name: "Status") {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  updatedAt
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  updatedAt
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  updatedAt
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  updatedAt
                }
              }
              priority: fieldValueByName(name: "Priority") {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  updatedAt
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  updatedAt
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  updatedAt
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  updatedAt
                }
              }
              initiationOptions: fieldValueByName(name: "Initiation Options") {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  updatedAt
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  updatedAt
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  updatedAt
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  updatedAt
                }
              }
              startDate: fieldValueByName(name: "Start date") {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  updatedAt
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  updatedAt
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  updatedAt
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  updatedAt
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  updatedAt
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const repositoryDiscussionsQuery = gql`
  query RepositoryDiscussions($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      discussions(first: 25, after: $cursor, orderBy: { field: UPDATED_AT, direction: ASC }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          __typename
          id
          number
          title
          url
          body
          bodyText
          bodyHTML
          createdAt
          updatedAt
          answerChosenAt
          answerable
          locked
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
          category {
            id
            name
            description
            isAnswerable
          }
          answerChosenBy {
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
          reactions(first: 25, orderBy: { field: CREATED_AT, direction: ASC }) {
            nodes {
              id
              content
              createdAt
              user {
                id
                login
                name
                avatarUrl(size: 200)
              }
            }
          }
        }
      }
    }
  }
`;

export const repositoryPullRequestsQuery = gql`
  query RepositoryPullRequests($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 25, after: $cursor, orderBy: { field: UPDATED_AT, direction: ASC }) {
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
          body
          bodyText
          bodyHTML
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
          mergedBy {
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
          labels(first: 50) {
            nodes {
              id
              name
              color
            }
          }
          timelineItems(last: 50, itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT]) {
            nodes {
              __typename
              ... on ReviewRequestedEvent {
                id
                createdAt
                requestedReviewer {
                  __typename
                  ... on User {
                    id
                    login
                    name
                    avatarUrl(size: 200)
                    createdAt
                    updatedAt
                  }
                  ... on Team {
                    id
                    slug
                    name
                  }
                }
              }
              ... on ReviewRequestRemovedEvent {
                id
                createdAt
                requestedReviewer {
                  __typename
                  ... on User {
                    id
                    login
                    name
                    avatarUrl(size: 200)
                    createdAt
                    updatedAt
                  }
                  ... on Team {
                    id
                    slug
                    name
                  }
                }
              }
            }
          }
          reactions(first: 25, orderBy: { field: CREATED_AT, direction: ASC }) {
            nodes {
              id
              content
              createdAt
              user {
                id
                login
                name
                avatarUrl(size: 200)
              }
            }
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
        reviews(first: 25, after: $cursor) {
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
        comments(first: 25, after: $cursor) {
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
            bodyText
            bodyHTML
            reactions(first: 25, orderBy: { field: CREATED_AT, direction: ASC }) {
              nodes {
                id
                content
                createdAt
                user {
                  id
                  login
                  name
                  avatarUrl(size: 200)
                }
              }
            }
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
            bodyText
            bodyHTML
            reactions(first: 25, orderBy: { field: CREATED_AT, direction: ASC }) {
              nodes {
                id
                content
                createdAt
                user {
                  id
                  login
                  name
                  avatarUrl(size: 200)
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const discussionCommentsQuery = gql`
  query DiscussionComments($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      discussion(number: $number) {
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
            bodyText
            bodyHTML
            replyTo {
              id
            }
            reactions(first: 25, orderBy: { field: CREATED_AT, direction: ASC }) {
              nodes {
                id
                content
                createdAt
                user {
                  id
                  login
                  name
                  avatarUrl(size: 200)
                }
              }
            }
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
        reviewThreads(first: 20, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            comments(first: 50) {
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
                bodyText
                bodyHTML
                pullRequestReview {
                  id
                }
                reactions(first: 25, orderBy: { field: CREATED_AT, direction: ASC }) {
                  nodes {
                    id
                    content
                    createdAt
                    user {
                      id
                      login
                      name
                      avatarUrl(size: 200)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
