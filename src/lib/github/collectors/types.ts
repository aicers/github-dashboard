import type { GraphQLClient } from "graphql-request";

export type SyncLogger = (message: string) => void;

export const RESOURCE_KEYS = [
  "repositories",
  "issues",
  "discussions",
  "pull_requests",
  "reviews",
  "comments",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export type SyncOptions = {
  org: string;
  since?: string | null;
  until?: string | null;
  sinceByResource?: Partial<Record<ResourceKey, string | null>>;
  logger?: SyncLogger;
  client?: GraphQLClient;
  runId?: number | null;
};

export type Maybe<T> = T | null | undefined;

export type GithubActor = {
  __typename: string;
  id: string;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ReviewRequestReviewer =
  | GithubActor
  | {
      __typename: "Team";
      id: string;
      slug?: string | null;
      name?: string | null;
    };

export type RepositoryNode = {
  id: string;
  name: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: GithubActor | null;
};

export type IssueTypeNode = {
  id: string;
  name?: string | null;
};

export type MilestoneNode = {
  id: string;
  title?: string | null;
  state?: string | null;
  dueOn?: string | null;
  url?: string | null;
};

export type IssueRelationNode = {
  id: string;
  number: number;
  title?: string | null;
  url?: string | null;
  state?: string | null;
  repository?: {
    nameWithOwner?: string | null;
  } | null;
};

export type IssueRelationConnection = {
  totalCount?: number | null;
  nodes?: IssueRelationNode[] | null;
};

export type IssueNode = {
  id: string;
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  body?: string | null;
  bodyText?: string | null;
  bodyHTML?: string | null;
  bodyMarkdown?: string | null;
  author?: GithubActor | null;
  assignees?: {
    nodes?: Maybe<GithubActor>[] | null;
  } | null;
  issueType?: IssueTypeNode | null;
  milestone?: MilestoneNode | null;
  trackedIssues?: IssueRelationConnection | null;
  trackedInIssues?: IssueRelationConnection | null;
  timelineItems?: {
    nodes: IssueTimelineItem[] | null;
  } | null;
  projectItems?: {
    nodes: ProjectV2ItemNode[] | null;
  } | null;
  labels?: {
    nodes?:
      | { id: string; name?: string | null; color?: string | null }[]
      | null;
  } | null;
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
  repository?: RepositoryNode | null;
};

export type DiscussionCategoryNode = {
  id: string;
  name?: string | null;
  description?: string | null;
  isAnswerable?: boolean | null;
};

export type DiscussionNode = {
  __typename?: string;
  id: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  bodyText?: string | null;
  bodyHTML?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  answerChosenAt?: string | null;
  locked?: boolean | null;
  author?: GithubActor | null;
  answerChosenBy?: GithubActor | null;
  category?: DiscussionCategoryNode | null;
  comments?: {
    totalCount?: number | null;
  } | null;
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
  repository?: RepositoryNode | null;
};

export type ActivityNodeResyncResponse = {
  node?:
    | (IssueNode & { __typename: "Issue" })
    | (PullRequestNode & { __typename: "PullRequest" })
    | (DiscussionNode & { __typename?: string | null })
    | null;
};

export function isIssueResyncNode(
  node: ActivityNodeResyncResponse["node"],
): node is IssueNode & { __typename: "Issue" } {
  return node?.__typename === "Issue";
}

export function isPullRequestResyncNode(
  node: ActivityNodeResyncResponse["node"],
): node is PullRequestNode & { __typename: "PullRequest" } {
  return node?.__typename === "PullRequest";
}

export function isDiscussionResyncNode(
  node: ActivityNodeResyncResponse["node"],
): node is DiscussionNode & { __typename?: string | null } {
  return node?.__typename === "Discussion";
}

export type PullRequestNode = IssueNode & {
  mergedAt?: string | null;
  merged?: boolean | null;
  mergedBy?: GithubActor | null;
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
  closingIssuesReferences?: IssueRelationConnection | null;
  timelineItems?: {
    nodes: PullRequestTimelineItem[] | null;
  } | null;
};

export type ReviewNode = {
  id: string;
  author?: GithubActor | null;
  submittedAt?: string | null;
  state?: string | null;
};

export type CommentNode = {
  id: string;
  __typename?: string | null;
  author?: GithubActor | null;
  createdAt: string;
  updatedAt?: string | null;
  url?: string | null;
  body?: string | null;
  bodyText?: string | null;
  bodyHTML?: string | null;
  replyTo?: { id?: string | null } | null;
  isAnswer?: boolean | null;
  pullRequestReview?: { id: string } | null;
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
  replies?: {
    pageInfo?: PageInfo | null;
    nodes?: CommentNode[] | null;
  } | null;
};

export type CommentCollectionResult = {
  latest: string | null;
  count: number;
  ids: string[];
};

export type DiscussionCollectionResult = {
  latestDiscussionUpdated: string | null;
  latestCommentUpdated: string | null;
  discussionCount: number;
  commentCount: number;
};

export type IssueTimelineItem =
  | {
      __typename: "AddedToProjectEvent";
      createdAt: string;
      projectColumnName?: string | null;
      project?: { name?: string | null } | null;
    }
  | {
      __typename: "MovedColumnsInProjectEvent";
      createdAt: string;
      projectColumnName?: string | null;
      previousProjectColumnName?: string | null;
      project?: { name?: string | null } | null;
    }
  | {
      __typename: string;
      createdAt?: string | null;
    };

export type ProjectV2ItemFieldValue =
  | {
      __typename: "ProjectV2ItemFieldSingleSelectValue";
      name?: string | null;
      updatedAt?: string | null;
    }
  | {
      __typename: "ProjectV2ItemFieldIterationValue";
      title?: string | null;
      updatedAt?: string | null;
    }
  | {
      __typename: "ProjectV2ItemFieldTextValue";
      text?: string | null;
      updatedAt?: string | null;
    }
  | {
      __typename: "ProjectV2ItemFieldNumberValue";
      number?: number | null;
      updatedAt?: string | null;
    }
  | {
      __typename: "ProjectV2ItemFieldDateValue";
      date?: string | null;
      updatedAt?: string | null;
    }
  | {
      __typename: string;
      updatedAt?: string | null;
    };

export type ProjectV2ItemNode = {
  id: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  project?: {
    title?: string | null;
  } | null;
  status?: ProjectV2ItemFieldValue | null;
  priority?: ProjectV2ItemFieldValue | null;
  initiationOptions?: ProjectV2ItemFieldValue | null;
  startDate?: ProjectV2ItemFieldValue | null;
};

export type ProjectStatusHistoryEntry = {
  projectItemId: string;
  projectTitle: string | null;
  status: string;
  occurredAt: string;
};

export type ReactionNode = {
  id: string;
  content?: string | null;
  createdAt?: string | null;
  user?: GithubActor | null;
};

export type PullRequestTimelineItem =
  | {
      __typename: "ReviewRequestedEvent";
      id: string;
      createdAt: string;
      requestedReviewer?: GithubActor | null;
    }
  | {
      __typename: "ReviewRequestRemovedEvent";
      id: string;
      createdAt: string;
      requestedReviewer?: GithubActor | null;
    }
  | {
      __typename: Exclude<
        string,
        "ReviewRequestedEvent" | "ReviewRequestRemovedEvent"
      >;
      id?: string;
      createdAt?: string | null;
      requestedReviewer?: never;
    };

export type ReviewCollectionResult = {
  latest: string | null;
  count: number;
  reviewIds: Set<string>;
};

export type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type GraphQLConnection<T> = {
  pageInfo: PageInfo;
  nodes: T[] | null;
};

export type OrganizationRepositoriesQueryResponse = {
  organization: {
    repositories: GraphQLConnection<RepositoryNode> | null;
  } | null;
};

export type RepositoryIssuesQueryResponse = {
  repository: {
    issues: GraphQLConnection<IssueNode> | null;
  } | null;
};

export type RepositoryDiscussionsQueryResponse = {
  repository: {
    discussions: GraphQLConnection<DiscussionNode> | null;
  } | null;
};

export type RepositoryPullRequestsQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestNode> | null;
  } | null;
};

export type IssueMetadataNode = {
  id: string;
  number: number;
  assignees?: {
    nodes?: Maybe<GithubActor>[] | null;
  } | null;
};

export type OpenIssueMetadataQueryResponse = {
  repository: {
    issues: GraphQLConnection<IssueMetadataNode> | null;
  } | null;
};

export type PullRequestMetadataNode = {
  id: string;
  number: number;
  assignees?: {
    nodes?: Maybe<GithubActor>[] | null;
  } | null;
  reviewRequests?: {
    nodes?:
      | {
          id: string;
          requestedReviewer?: ReviewRequestReviewer | null;
        }[]
      | null;
  } | null;
  timelineItems?: {
    nodes?:
      | {
          __typename: "ReviewRequestedEvent";
          createdAt: string;
          requestedReviewer?: ReviewRequestReviewer | null;
        }[]
      | null;
  } | null;
};

export type OpenPullRequestMetadataQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestMetadataNode> | null;
  } | null;
};

export type PullRequestMetadataByNumberNode = PullRequestMetadataNode & {
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  merged?: boolean | null;
  author?: GithubActor | null;
};

export type PullRequestMetadataByNumberQueryResponse = {
  repository: {
    pullRequest: PullRequestMetadataByNumberNode | null;
  } | null;
};

export type PullRequestLinkNode = {
  id: string;
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  merged?: boolean | null;
  author?: GithubActor | null;
  mergedBy?: GithubActor | null;
  assignees?: {
    nodes?: Maybe<GithubActor>[] | null;
  } | null;
  closingIssuesReferences?: IssueRelationConnection | null;
};

export type RepositoryPullRequestLinksQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestLinkNode> | null;
  } | null;
};

export type PullRequestReviewsQueryResponse = {
  repository: {
    pullRequest: {
      reviews: GraphQLConnection<ReviewNode> | null;
    } | null;
  } | null;
};

export type PullRequestReviewCommentsQueryResponse = {
  repository: {
    pullRequest: {
      reviewThreads: GraphQLConnection<{
        id: string;
        comments: {
          nodes: CommentNode[] | null;
        } | null;
      }> | null;
    } | null;
  } | null;
};

export type IssueCommentsQueryResponse = {
  repository: {
    issue: {
      comments: GraphQLConnection<CommentNode> | null;
    } | null;
  } | null;
};

export type PullRequestCommentsQueryResponse = {
  repository: {
    pullRequest: {
      comments: GraphQLConnection<CommentNode> | null;
    } | null;
  } | null;
};

export type DiscussionCommentsQueryResponse = {
  repository: {
    discussion: {
      answer?: CommentNode | null;
      comments: GraphQLConnection<CommentNode> | null;
    } | null;
  } | null;
};

export type DiscussionCommentRepliesQueryResponse = {
  node?: {
    __typename?: string | null;
    replies?: GraphQLConnection<CommentNode> | null;
  } | null;
};

export type CommentTarget = "issue" | "pull_request" | "discussion";
