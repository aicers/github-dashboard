import type { GraphQLClient, RequestDocument } from "graphql-request";
import { ClientError } from "graphql-request";

import { clearProjectFieldOverrides } from "@/lib/activity/project-field-store";
import { clearActivityStatuses } from "@/lib/activity/status-store";
import {
  fetchIssueRawMap,
  listPendingReviewRequestsByPullRequestIds,
  markReviewRequestRemoved,
  type PendingReviewRequest,
  recordSyncLog,
  replacePullRequestIssues,
  reviewExists,
  updateIssueAssignees,
  updatePullRequestAssignees,
  updateSyncLog,
  updateSyncState,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import { createGithubClient } from "@/lib/github/client";
import {
  activityNodeResyncQuery,
  discussionCommentsQuery,
  issueCommentsQuery,
  openIssueMetadataQuery,
  openPullRequestMetadataQuery,
  organizationRepositoriesQuery,
  pullRequestCommentsQuery,
  pullRequestReviewCommentsQuery,
  pullRequestReviewsQuery,
  repositoryDiscussionsQuery,
  repositoryIssuesQuery,
  repositoryPullRequestLinksQuery,
  repositoryPullRequestsQuery,
} from "@/lib/github/queries";
export type SyncLogger = (message: string) => void;

export type SyncOptions = {
  org: string;
  since?: string | null;
  until?: string | null;
  sinceByResource?: Partial<Record<ResourceKey, string | null>>;
  logger?: SyncLogger;
  client?: GraphQLClient;
  runId?: number | null;
};

type Maybe<T> = T | null | undefined;

type GithubActor = {
  __typename: string;
  id: string;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ReviewRequestReviewer =
  | GithubActor
  | {
      __typename: "Team";
      id: string;
      slug?: string | null;
      name?: string | null;
    };

type RepositoryNode = {
  id: string;
  name: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: GithubActor | null;
};

type IssueTypeNode = {
  id: string;
  name?: string | null;
};

type MilestoneNode = {
  id: string;
  title?: string | null;
  state?: string | null;
  dueOn?: string | null;
  url?: string | null;
};

type IssueRelationNode = {
  id: string;
  number: number;
  title?: string | null;
  url?: string | null;
  state?: string | null;
  repository?: {
    nameWithOwner?: string | null;
  } | null;
};

type IssueRelationConnection = {
  totalCount?: number | null;
  nodes?: IssueRelationNode[] | null;
};

type IssueNode = {
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

type DiscussionCategoryNode = {
  id: string;
  name?: string | null;
  description?: string | null;
  isAnswerable?: boolean | null;
};

type DiscussionNode = {
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

type ActivityNodeResyncResponse = {
  node?:
    | (IssueNode & { __typename: "Issue" })
    | (PullRequestNode & { __typename: "PullRequest" })
    | (DiscussionNode & { __typename?: string | null })
    | null;
};

function wrapGithubError(error: unknown, context: string): Error {
  if (error instanceof ClientError) {
    const messages =
      error.response?.errors
        ?.map((entry) =>
          typeof entry?.message === "string" ? entry.message.trim() : null,
        )
        .filter((message): message is string => Boolean(message)) ?? [];
    const details = messages.length
      ? messages.join("; ")
      : error.message || "Unknown GitHub API error.";
    return new Error(`${context}: ${details}`, { cause: error });
  }
  if (error instanceof Error) {
    return new Error(`${context}: ${error.message}`, { cause: error });
  }
  return new Error(context);
}

function isIssueResyncNode(
  node: ActivityNodeResyncResponse["node"],
): node is IssueNode & { __typename: "Issue" } {
  return node?.__typename === "Issue";
}

function isPullRequestResyncNode(
  node: ActivityNodeResyncResponse["node"],
): node is PullRequestNode & { __typename: "PullRequest" } {
  return node?.__typename === "PullRequest";
}

function isDiscussionResyncNode(
  node: ActivityNodeResyncResponse["node"],
): node is DiscussionNode & { __typename?: string | null } {
  return node?.__typename === "Discussion";
}

type PullRequestNode = IssueNode & {
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

type ReviewNode = {
  id: string;
  author?: GithubActor | null;
  submittedAt?: string | null;
  state?: string | null;
};

type CommentNode = {
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
};

type CommentCollectionResult = {
  latest: string | null;
  count: number;
};

type DiscussionCollectionResult = {
  latestDiscussionUpdated: string | null;
  latestCommentUpdated: string | null;
  discussionCount: number;
  commentCount: number;
};

type IssueTimelineItem =
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

type ProjectV2ItemFieldValue =
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

type ProjectV2ItemNode = {
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

type ProjectStatusHistoryEntry = {
  projectItemId: string;
  projectTitle: string | null;
  status: string;
  occurredAt: string;
};

const PROJECT_REMOVED_STATUS = "__PROJECT_REMOVED__";
function normalizeProjectName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

const TARGET_TODO_PROJECT = normalizeProjectName(env.TODO_PROJECT_NAME);

function isTargetProject(projectTitle: unknown) {
  if (!TARGET_TODO_PROJECT) {
    return false;
  }
  if (typeof projectTitle !== "string") {
    return false;
  }
  return normalizeProjectName(projectTitle) === TARGET_TODO_PROJECT;
}

type ReactionNode = {
  id: string;
  content?: string | null;
  createdAt?: string | null;
  user?: GithubActor | null;
};

type PullRequestTimelineItem =
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

type ReviewCollectionResult = {
  latest: string | null;
  count: number;
  reviewIds: Set<string>;
};

type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type GraphQLConnection<T> = {
  pageInfo: PageInfo;
  nodes: T[] | null;
};

type OrganizationRepositoriesQueryResponse = {
  organization: {
    repositories: GraphQLConnection<RepositoryNode> | null;
  } | null;
};

type RepositoryIssuesQueryResponse = {
  repository: {
    issues: GraphQLConnection<IssueNode> | null;
  } | null;
};

type RepositoryDiscussionsQueryResponse = {
  repository: {
    discussions: GraphQLConnection<DiscussionNode> | null;
  } | null;
};

type RepositoryPullRequestsQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestNode> | null;
  } | null;
};

type IssueMetadataNode = {
  id: string;
  number: number;
  assignees?: {
    nodes?: Maybe<GithubActor>[] | null;
  } | null;
};

type OpenIssueMetadataQueryResponse = {
  repository: {
    issues: GraphQLConnection<IssueMetadataNode> | null;
  } | null;
};

type PullRequestMetadataNode = {
  id: string;
  number: number;
  assignees?: {
    nodes?: Maybe<GithubActor>[] | null;
  } | null;
  reviewRequests?: {
    nodes?:
      | {
          id: string;
          createdAt?: string | null;
          requestedReviewer?: ReviewRequestReviewer | null;
        }[]
      | null;
  } | null;
};

type OpenPullRequestMetadataQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestMetadataNode> | null;
  } | null;
};

type PullRequestLinkNode = {
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

type RepositoryPullRequestLinksQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestLinkNode> | null;
  } | null;
};

type PullRequestReviewsQueryResponse = {
  repository: {
    pullRequest: {
      reviews: GraphQLConnection<ReviewNode> | null;
    } | null;
  } | null;
};

type PullRequestReviewCommentsQueryResponse = {
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

type IssueCommentsQueryResponse = {
  repository: {
    issue: {
      comments: GraphQLConnection<CommentNode> | null;
    } | null;
  } | null;
};

type PullRequestCommentsQueryResponse = {
  repository: {
    pullRequest: {
      comments: GraphQLConnection<CommentNode> | null;
    } | null;
  } | null;
};

type DiscussionCommentsQueryResponse = {
  repository: {
    discussion: {
      answer?: CommentNode | null;
      comments: GraphQLConnection<CommentNode> | null;
    } | null;
  } | null;
};

export const RESOURCE_KEYS = [
  "repositories",
  "issues",
  "discussions",
  "pull_requests",
  "reviews",
  "comments",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const RATE_LIMIT_ERROR_CODES = new Set([
  "RATE_LIMIT",
  "RATE_LIMITED",
  "GRAPHQL_RATE_LIMIT",
  "graphql_rate_limit",
]);
const MAX_RETRY_ATTEMPTS = 3;
const MAX_RATE_LIMIT_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 500;
const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000;
const BACKOFF_FACTOR = 2;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function isRateLimitError(error: unknown): error is ClientError {
  if (!(error instanceof ClientError)) {
    return false;
  }

  const responseErrors = Array.isArray(error.response?.errors)
    ? error.response.errors
    : [];

  for (const graphqlError of responseErrors) {
    const errorRecord = asRecord(graphqlError);
    if (!errorRecord) {
      continue;
    }

    const markers: string[] = [];
    const directType = errorRecord.type;
    if (typeof directType === "string") {
      markers.push(directType);
    }

    const directCode = errorRecord.code;
    if (typeof directCode === "string") {
      markers.push(directCode);
    }

    const extensionsRecord = asRecord(errorRecord.extensions);
    if (extensionsRecord) {
      const extensionType = extensionsRecord.type;
      if (typeof extensionType === "string") {
        markers.push(extensionType);
      }

      const extensionCode = extensionsRecord.code;
      if (typeof extensionCode === "string") {
        markers.push(extensionCode);
      }
    }

    if (markers.some((marker) => RATE_LIMIT_ERROR_CODES.has(marker))) {
      return true;
    }
  }

  return /rate limit/i.test(error.message ?? "");
}

function getHeaderValue(headers: unknown, key: string): string | null {
  if (!headers) {
    return null;
  }

  const headerKey = key.toLowerCase();
  const headersWithGet = headers as {
    get?: (name: string) => string | null | undefined;
  };
  if (typeof headersWithGet.get === "function") {
    const headerValue =
      headersWithGet.get(key) ?? headersWithGet.get(headerKey);
    if (typeof headerValue === "string" && headerValue.length > 0) {
      return headerValue;
    }
  }

  if (typeof headers === "object") {
    for (const [rawKey, value] of Object.entries(
      headers as Record<string, unknown>,
    )) {
      if (rawKey.toLowerCase() !== headerKey) {
        continue;
      }

      if (typeof value === "string") {
        return value;
      }

      if (Array.isArray(value)) {
        const firstValue = value.find((item) => typeof item === "string");
        if (typeof firstValue === "string") {
          return firstValue;
        }
      }

      if (value != null) {
        return String(value);
      }
    }
  }

  return null;
}

function parseRetryAfterHeader(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) {
      return 0;
    }
    return numeric * 1000;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const waitMs = timestamp - Date.now();
  return waitMs > 0 ? waitMs : 0;
}

function parseResetHeader(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    const waitMs = numeric * 1000 - Date.now();
    return waitMs > 0 ? waitMs : 0;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const waitMs = timestamp - Date.now();
  return waitMs > 0 ? waitMs : 0;
}

function parseExtensionDelay(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return 0;
    }
    return value * 1000;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      if (asNumber <= 0) {
        return 0;
      }
      return asNumber * 1000;
    }

    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      const waitMs = timestamp - Date.now();
      return waitMs > 0 ? waitMs : 0;
    }
  }

  return null;
}

function parseExtensionReset(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      const waitMs = timestamp - Date.now();
      return waitMs > 0 ? waitMs : 0;
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const waitMs = value * 1000 - Date.now();
    return waitMs > 0 ? waitMs : 0;
  }

  return null;
}

function getRateLimitRetryDelayMs(error: ClientError): number {
  const headers = (error.response as Record<string, unknown>)?.headers ?? null;

  const retryAfterHeader =
    typeof headers === "object" ? getHeaderValue(headers, "retry-after") : null;
  if (typeof retryAfterHeader === "string") {
    const delayFromHeader = parseRetryAfterHeader(retryAfterHeader);
    if (delayFromHeader != null) {
      return Math.max(delayFromHeader, DEFAULT_RATE_LIMIT_DELAY_MS);
    }
  }

  const resetHeader =
    typeof headers === "object"
      ? getHeaderValue(headers, "x-ratelimit-reset")
      : null;
  if (typeof resetHeader === "string") {
    const delayFromReset = parseResetHeader(resetHeader);
    if (delayFromReset != null) {
      return Math.max(delayFromReset, DEFAULT_RATE_LIMIT_DELAY_MS);
    }
  }

  const responseErrors = Array.isArray(error.response?.errors)
    ? error.response.errors
    : [];

  for (const graphqlError of responseErrors) {
    const errorRecord = asRecord(graphqlError);
    if (!errorRecord) {
      continue;
    }

    const extensionsRecord = asRecord(errorRecord.extensions);
    if (!extensionsRecord) {
      continue;
    }

    const delayKeys = [
      "retryAfter",
      "retry_after",
      "retryAfterSeconds",
      "retry_after_seconds",
      "wait",
      "seconds",
      "resetAfter",
      "reset_after",
    ];

    for (const key of delayKeys) {
      const extensionDelay = parseExtensionDelay(extensionsRecord[key]);
      if (extensionDelay != null) {
        return Math.max(extensionDelay, DEFAULT_RATE_LIMIT_DELAY_MS);
      }
    }

    const resetKeys = ["resetAt", "reset_at", "resetTime", "reset_time"];
    for (const key of resetKeys) {
      const extensionReset = parseExtensionReset(extensionsRecord[key]);
      if (extensionReset != null) {
        return Math.max(extensionReset, DEFAULT_RATE_LIMIT_DELAY_MS);
      }
    }
  }

  return DEFAULT_RATE_LIMIT_DELAY_MS;
}

function toActor(actor: Maybe<GithubActor>) {
  if (!actor?.id) {
    return null;
  }

  return {
    id: actor.id,
    login: actor.login ?? null,
    name: actor.name ?? null,
    avatarUrl: actor.avatarUrl ?? null,
    createdAt: actor.createdAt ?? null,
    updatedAt: actor.updatedAt ?? null,
    __typename: actor.__typename,
  };
}

type TimeBounds = {
  since: number | null;
  until: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function createBounds(
  since?: string | null,
  until?: string | null,
): TimeBounds {
  return {
    since: toTime(since),
    until: toTime(until),
  };
}

function formatBoundsForLog(bounds: TimeBounds) {
  const sinceIso =
    bounds.since !== null ? new Date(bounds.since).toISOString() : null;
  const untilIso =
    bounds.until !== null ? new Date(bounds.until).toISOString() : null;

  if (!sinceIso && !untilIso) {
    return "";
  }

  const parts: string[] = [];
  if (sinceIso && untilIso) {
    parts.push(`period: ${sinceIso} <= updatedAt < ${untilIso}`);
  } else if (sinceIso) {
    parts.push(`period: updatedAt >= ${sinceIso}`);
  } else if (untilIso) {
    parts.push(`period: updatedAt < ${untilIso}`);
  }

  if (bounds.since !== null) {
    const exclusiveEndMs = bounds.until ?? Date.now();
    const spanMs = Math.max(0, exclusiveEndMs - bounds.since);
    const days = Math.max(1, Math.ceil(spanMs / MS_PER_DAY));
    const approximate = bounds.until === null;
    const prefix = approximate ? "~" : "";
    const plural = days === 1 ? "day" : "days";
    const suffix = approximate ? " so far" : "";
    parts.push(`span: ${prefix}${days} ${plural} of data${suffix}`);
  }

  return parts.length ? ` (${parts.join("; ")})` : "";
}

type TimestampEvaluation = {
  include: boolean;
  afterUpperBound: boolean;
  beforeLowerBound: boolean;
};

function evaluateTimestamp(
  timestamp: string | null | undefined,
  bounds: TimeBounds,
): TimestampEvaluation {
  const value = toTime(timestamp);
  if (value === null) {
    return {
      include: false,
      afterUpperBound: false,
      beforeLowerBound: false,
    };
  }

  if (bounds.since !== null && value < bounds.since) {
    return {
      include: false,
      afterUpperBound: false,
      beforeLowerBound: true,
    };
  }

  if (bounds.until !== null && value >= bounds.until) {
    return {
      include: false,
      afterUpperBound: true,
      beforeLowerBound: false,
    };
  }

  return {
    include: true,
    afterUpperBound: false,
    beforeLowerBound: false,
  };
}

async function processActor(actor: Maybe<GithubActor>) {
  const normalized = toActor(actor);
  if (!normalized) {
    return null;
  }

  await upsertUser(normalized);
  return normalized.id;
}

async function processActorNodes(
  nodes: Maybe<GithubActor>[] | null | undefined,
) {
  if (!Array.isArray(nodes)) {
    return;
  }

  for (const actor of nodes) {
    await processActor(actor);
  }
}

function normalizeAssigneeNodes(
  nodes: Maybe<GithubActor>[] | null | undefined,
) {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.map((node) => (node && typeof node === "object" ? node : null));
}

function buildAssigneesPayload(
  assignees: { nodes?: Maybe<GithubActor>[] | null } | null | undefined,
) {
  return {
    nodes: normalizeAssigneeNodes(assignees?.nodes ?? null),
  };
}

function reviewerIsUser(
  reviewer: ReviewRequestReviewer | null | undefined,
): reviewer is GithubActor {
  return Boolean(reviewer && reviewer.__typename === "User");
}

async function syncReviewRequestsSnapshot(
  pullRequest: PullRequestMetadataNode,
  pendingRequests: PendingReviewRequest[] | undefined,
) {
  let added = 0;
  let removed = 0;
  const requests = pullRequest.reviewRequests?.nodes ?? [];
  const activeReviewerIds = new Set<string>();

  for (const entry of requests) {
    if (!entry) {
      continue;
    }
    const reviewer = entry.requestedReviewer;
    if (!reviewerIsUser(reviewer)) {
      continue;
    }
    await processActor(reviewer);
    const requestedAt =
      typeof entry.createdAt === "string" && entry.createdAt.trim().length
        ? entry.createdAt
        : new Date().toISOString();
    await upsertReviewRequest({
      id: entry.id,
      pullRequestId: pullRequest.id,
      reviewerId: reviewer.id,
      requestedAt,
      raw: entry,
    });
    activeReviewerIds.add(reviewer.id);
    added += 1;
  }

  const pending = pendingRequests ?? [];
  if (!pending.length) {
    return { added, removed };
  }

  const removalTimestamp = new Date().toISOString();
  for (const pendingRequest of pending) {
    const reviewerId = pendingRequest.reviewerId;
    if (!reviewerId || activeReviewerIds.has(reviewerId)) {
      continue;
    }
    await markReviewRequestRemoved({
      pullRequestId: pullRequest.id,
      reviewerId,
      removedAt: removalTimestamp,
      raw: {
        reason: "open-item-metadata-refresh",
        sourceRequestId: pendingRequest.id,
      },
    });
    removed += 1;
  }

  return { added, removed };
}

function normalizeReactionSubjectType(
  subjectType: string | null | undefined,
): string {
  if (typeof subjectType !== "string") {
    return "unknown";
  }

  const trimmed = subjectType.trim();
  return trimmed.length ? trimmed : "unknown";
}

function resolveCommentReactionSubjectType(
  target: CommentTarget,
  comment: CommentNode,
): string {
  const typename =
    typeof comment.__typename === "string" ? comment.__typename.trim() : "";
  if (typename.length && typename.toLowerCase() !== "comment") {
    return typename;
  }

  if (comment.pullRequestReview?.id) {
    return "PullRequestReviewComment";
  }

  if (target === "discussion") {
    return "DiscussionComment";
  }

  return "IssueComment";
}

async function processReactions(
  reactions: Maybe<{ nodes: ReactionNode[] | null }>,
  subjectType: string,
  subjectId: string,
) {
  const reactionNodes = reactions?.nodes ?? [];
  const normalizedSubjectType = normalizeReactionSubjectType(subjectType);
  for (const reaction of reactionNodes) {
    if (!reaction?.id) {
      continue;
    }

    const userId = await processActor(reaction.user);
    await upsertReaction({
      id: reaction.id,
      subjectType: normalizedSubjectType,
      subjectId,
      userId: userId ?? null,
      content: reaction.content ?? null,
      createdAt: reaction.createdAt ?? null,
      raw: reaction,
    });
  }
}

function maxTimestamp(
  current: string | null,
  candidate: string | null | undefined,
) {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  return new Date(candidate) > new Date(current) ? candidate : current;
}

function ensureLogId(id: number | undefined) {
  if (typeof id !== "number") {
    throw new Error("Failed to record sync log entry.");
  }

  return id;
}

function isNotFoundError(error: unknown) {
  if (error instanceof ClientError) {
    return (error.response?.errors ?? []).some(
      (item) => item.extensions?.code === "NOT_FOUND",
    );
  }

  return false;
}

function isRetryableError(error: unknown) {
  if (error instanceof ClientError) {
    const status = error.response?.status ?? 0;
    return RETRYABLE_STATUS_CODES.has(status);
  }

  return error instanceof Error;
}

function describeError(error: unknown) {
  if (error instanceof ClientError) {
    const status = error.response?.status;
    return `status ${status ?? "unknown"}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "unknown error";
}

async function requestWithRetry<T>(
  client: GraphQLClient,
  document: RequestDocument,
  variables: Record<string, unknown>,
  options: { logger?: SyncLogger; context?: string; retries?: number } = {},
): Promise<T> {
  const { logger, context, retries = MAX_RETRY_ATTEMPTS } = options;
  let attempt = 0;
  let delay = BASE_RETRY_DELAY_MS;
  let lastError: unknown = null;
  let rateLimitRetryCount = 0;

  while (attempt < retries) {
    try {
      return await client.request<T>(document, variables);
    } catch (error) {
      lastError = error;

      if (isRateLimitError(error)) {
        rateLimitRetryCount += 1;
        if (rateLimitRetryCount > MAX_RATE_LIMIT_RETRIES) {
          throw error;
        }

        const waitMs = getRateLimitRetryDelayMs(error);
        const waitSeconds = Math.ceil(waitMs / 1000);
        const contextLabel = context ?? "request";
        logger?.(
          `Rate limit reached for ${contextLabel}. Waiting ${waitSeconds}s before retrying (${rateLimitRetryCount}/${MAX_RATE_LIMIT_RETRIES}).`,
        );
        await sleep(waitMs);
        continue;
      }

      if (!isRetryableError(error) || attempt === retries - 1) {
        throw error;
      }

      const attemptNumber = attempt + 1;
      logger?.(
        `Retrying ${context ?? "request"} (${attemptNumber}/${retries}) after ${describeError(error)}...`,
      );
      await sleep(delay);
      delay *= BACKOFF_FACTOR;
      attempt += 1;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("GraphQL request failed after retries");
}

function resolveSince(options: SyncOptions, resource: ResourceKey) {
  return options.sinceByResource?.[resource] ?? options.since ?? null;
}

function resolveUntil(options: SyncOptions) {
  return options.until ?? null;
}

function extractProjectStatusHistoryFromRaw(
  raw: unknown,
): ProjectStatusHistoryEntry[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const record = raw as Record<string, unknown>;
  const history = record.projectStatusHistory;
  if (!Array.isArray(history)) {
    return [];
  }

  const entries: ProjectStatusHistoryEntry[] = [];
  history.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const data = item as Record<string, unknown>;
    const projectItemId =
      typeof data.projectItemId === "string" ? data.projectItemId : null;
    const status = typeof data.status === "string" ? data.status : null;
    const occurredAt =
      typeof data.occurredAt === "string" ? data.occurredAt : null;
    if (!projectItemId || !status || !occurredAt) {
      return;
    }
    const projectTitle =
      typeof data.projectTitle === "string" ? data.projectTitle : null;
    entries.push({ projectItemId, projectTitle, status, occurredAt });
  });

  return entries;
}

function extractProjectFieldValueLabel(
  value: ProjectV2ItemFieldValue | null | undefined,
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  if (typeof record.title === "string" && record.title.trim()) {
    return record.title.trim();
  }
  if (typeof record.text === "string" && record.text.trim()) {
    return record.text.trim();
  }
  if (typeof record.number === "number" && Number.isFinite(record.number)) {
    return String(record.number);
  }
  if (typeof (record as { date?: unknown }).date === "string") {
    const dateValue = (record as { date?: string | null }).date;
    if (dateValue?.trim()) {
      return dateValue.trim();
    }
  }

  return null;
}

function resolveStatusTimestamp(item: ProjectV2ItemNode): string | null {
  const statusRecord =
    item.status && typeof item.status === "object"
      ? (item.status as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [];
  if (statusRecord) {
    candidates.push(statusRecord.updatedAt, statusRecord.createdAt);
  }
  candidates.push(item.updatedAt, item.createdAt);

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
}

function collectProjectStatusSnapshots(
  issue: IssueNode,
): ProjectStatusHistoryEntry[] {
  if (!TARGET_TODO_PROJECT) {
    return [];
  }

  const nodes = Array.isArray(issue.projectItems?.nodes)
    ? (issue.projectItems?.nodes as ProjectV2ItemNode[])
    : [];

  const snapshots: ProjectStatusHistoryEntry[] = [];
  nodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const projectItemId = typeof node.id === "string" ? node.id : null;
    if (!projectItemId) {
      return;
    }

    const projectTitle =
      node.project && typeof node.project === "object"
        ? typeof node.project.title === "string"
          ? node.project.title
          : null
        : null;

    if (!isTargetProject(projectTitle)) {
      return;
    }

    const statusLabel = extractProjectFieldValueLabel(node.status ?? null);
    const occurredAt = resolveStatusTimestamp(node);

    if (!statusLabel || !occurredAt) {
      return;
    }

    snapshots.push({
      projectItemId,
      projectTitle,
      status: statusLabel,
      occurredAt,
    });
  });

  return snapshots;
}

function mergeProjectStatusHistory(
  existing: ProjectStatusHistoryEntry[],
  snapshots: ProjectStatusHistoryEntry[],
): ProjectStatusHistoryEntry[] {
  const map = new Map<string, ProjectStatusHistoryEntry>();

  const createKey = (entry: ProjectStatusHistoryEntry) =>
    `${entry.projectItemId}|${entry.status}|${entry.occurredAt}`;

  existing.forEach((entry) => {
    map.set(createKey(entry), { ...entry });
  });

  snapshots.forEach((snapshot) => {
    const key = createKey(snapshot);
    const current = map.get(key);
    if (current) {
      if (!current.projectTitle && snapshot.projectTitle) {
        current.projectTitle = snapshot.projectTitle;
      }
      return;
    }
    map.set(key, { ...snapshot });
  });

  const entries = Array.from(map.values());
  entries.sort((a, b) => {
    const left = Date.parse(a.occurredAt);
    const right = Date.parse(b.occurredAt);
    if (!Number.isNaN(left) && !Number.isNaN(right)) {
      return left - right;
    }
    return a.occurredAt.localeCompare(b.occurredAt);
  });

  return entries;
}

function createRemovalEntries(
  previous: ProjectStatusHistoryEntry[],
  currentSnapshots: ProjectStatusHistoryEntry[],
  detectedAt: string | null,
): ProjectStatusHistoryEntry[] {
  if (!previous.length) {
    return [];
  }

  const currentIds = new Set(
    currentSnapshots.map((entry) => entry.projectItemId),
  );
  const timestamp = detectedAt ?? new Date().toISOString();
  const grouped = new Map<string, ProjectStatusHistoryEntry[]>();

  previous.forEach((entry) => {
    const list = grouped.get(entry.projectItemId);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(entry.projectItemId, [entry]);
    }
  });

  const removals: ProjectStatusHistoryEntry[] = [];
  for (const [projectItemId, entries] of grouped) {
    if (currentIds.has(projectItemId)) {
      continue;
    }

    if (entries.some((entry) => entry.status === PROJECT_REMOVED_STATUS)) {
      continue;
    }

    const sorted = [...entries].sort((left, right) => {
      const leftTime = Date.parse(left.occurredAt);
      const rightTime = Date.parse(right.occurredAt);
      if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
        return 0;
      }
      if (Number.isNaN(leftTime)) {
        return -1;
      }
      if (Number.isNaN(rightTime)) {
        return 1;
      }
      return leftTime - rightTime;
    });
    const lastEntry = sorted[sorted.length - 1];
    removals.push({
      projectItemId,
      projectTitle: lastEntry?.projectTitle ?? null,
      status: PROJECT_REMOVED_STATUS,
      occurredAt: timestamp,
    });
  }

  return removals;
}

type CommentTarget = "issue" | "pull_request" | "discussion";

async function collectIssueComments(
  client: GraphQLClient,
  repository: RepositoryNode,
  issue: { id: string; number?: number | null },
  options: SyncOptions,
  target: CommentTarget = "issue",
): Promise<CommentCollectionResult> {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "comments");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  if (!issue.number) {
    return { latest: null, count: 0 };
  }

  let cursor: string | null = null;
  let hasNextPage = true;
  let latest: string | null = null;
  let count = 0;
  const processedCommentIds = new Set<string>();
  const [owner, name] = repository.nameWithOwner.split("/");

  while (hasNextPage) {
    const logLabel =
      target === "pull_request"
        ? "pull request"
        : target === "discussion"
          ? "discussion"
          : "issue";
    logger?.(
      `Fetching ${logLabel} comments for ${repository.nameWithOwner} #${issue.number ?? "unknown"}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    let connection: {
      pageInfo?: PageInfo | null;
      nodes?: CommentNode[] | null;
    } | null = null;
    let extraDiscussionComments: CommentNode[] = [];
    try {
      if (target === "pull_request") {
        const data: PullRequestCommentsQueryResponse = await requestWithRetry(
          client,
          pullRequestCommentsQuery,
          {
            owner,
            name,
            number: issue.number,
            cursor,
          },
          {
            logger,
            context: `${logLabel} comments ${repository.nameWithOwner}#${issue.number}`,
          },
        );
        connection = data.repository?.pullRequest?.comments ?? null;
      } else if (target === "discussion") {
        const data: DiscussionCommentsQueryResponse = await requestWithRetry(
          client,
          discussionCommentsQuery,
          {
            owner,
            name,
            number: issue.number,
            cursor,
          },
          {
            logger,
            context: `${logLabel} comments ${repository.nameWithOwner}#${issue.number}`,
          },
        );
        const discussionData = data.repository?.discussion ?? null;
        connection = discussionData?.comments ?? null;
        const answerComment = discussionData?.answer ?? null;
        if (answerComment) {
          extraDiscussionComments = [
            {
              ...answerComment,
              isAnswer:
                typeof answerComment.isAnswer === "boolean"
                  ? answerComment.isAnswer
                  : true,
            },
          ];
          logger?.(
            `[${logLabel}] Accepted answer comment ${answerComment.id ?? "unknown"} captured for ${repository.nameWithOwner}#${issue.number ?? "unknown"}`,
          );
        }
      } else {
        const data: IssueCommentsQueryResponse = await requestWithRetry(
          client,
          issueCommentsQuery,
          {
            owner,
            name,
            number: issue.number,
            cursor,
          },
          {
            logger,
            context: `issue comments ${repository.nameWithOwner}#${issue.number}`,
          },
        );
        connection = data.repository?.issue?.comments ?? null;
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        logger?.(
          `${logLabel.charAt(0).toUpperCase() + logLabel.slice(1)} ${repository.nameWithOwner} #${issue.number} no longer exists. Skipping comment collection.`,
        );
        break;
      }

      throw error;
    }

    if (!connection) {
      logger?.(
        `${logLabel.charAt(0).toUpperCase() + logLabel.slice(1)} ${repository.nameWithOwner} #${issue.number} was not found. Skipping comment collection.`,
      );
      break;
    }

    const baseNodes: CommentNode[] = connection.nodes ?? [];
    const commentNodes =
      extraDiscussionComments.length > 0
        ? [...baseNodes, ...extraDiscussionComments]
        : baseNodes;
    let reachedUpperBound = false;

    for (const comment of commentNodes) {
      if (!comment?.id || processedCommentIds.has(comment.id)) {
        continue;
      }

      processedCommentIds.add(comment.id);
      const timestamp = comment.updatedAt ?? comment.createdAt;
      const decision = evaluateTimestamp(timestamp, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          reachedUpperBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(comment.author);
      const isIssueTarget = target === "issue" || target === "discussion";
      await upsertComment({
        id: comment.id,
        issueId: isIssueTarget ? issue.id : null,
        pullRequestId: isIssueTarget ? null : issue.id,
        reviewId: comment.pullRequestReview?.id ?? null,
        authorId: authorId ?? null,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt ?? null,
        raw: comment,
      });

      const reactionSubjectType = resolveCommentReactionSubjectType(
        target,
        comment,
      );
      await processReactions(
        comment.reactions,
        reactionSubjectType,
        comment.id,
      );

      latest = maxTimestamp(latest, timestamp);
      count += 1;
    }

    if (reachedUpperBound) {
      hasNextPage = false;
      cursor = null;
      break;
    }

    hasNextPage = connection.pageInfo?.hasNextPage ?? false;
    cursor = connection.pageInfo?.endCursor ?? null;
    if (!hasNextPage) {
      cursor = null;
    }
  }

  return { latest, count };
}

async function collectDiscussionsForRepository(
  client: GraphQLClient,
  repository: RepositoryNode,
  options: SyncOptions,
): Promise<DiscussionCollectionResult> {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "discussions");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  let cursor: string | null = null;
  let hasNextPage = true;
  const [owner, name] = repository.nameWithOwner.split("/");
  let latestDiscussionUpdated: string | null = null;
  let latestCommentUpdated: string | null = null;
  let discussionCount = 0;
  let commentCount = 0;

  while (hasNextPage) {
    logger?.(
      `Fetching discussions for ${repository.nameWithOwner}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    const data: RepositoryDiscussionsQueryResponse =
      await requestWithRetry<RepositoryDiscussionsQueryResponse>(
        client,
        repositoryDiscussionsQuery,
        {
          owner,
          name,
          cursor,
        },
        {
          logger,
          context: `discussions ${repository.nameWithOwner}`,
        },
      );

    const discussionsConnection = data.repository?.discussions;
    const discussionNodes: DiscussionNode[] =
      discussionsConnection?.nodes ?? [];
    const fetchedDiscussionCount = discussionNodes.length;
    let upsertedDiscussionCount = 0;
    let reachedLowerBound = false;

    for (const discussion of discussionNodes) {
      const decision = evaluateTimestamp(discussion.updatedAt, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          continue;
        }
        if (decision.beforeLowerBound) {
          reachedLowerBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(discussion.author);
      await processActor(discussion.answerChosenBy);

      const rawDiscussion =
        typeof discussion.__typename === "string" &&
        discussion.__typename.length > 0
          ? discussion
          : { ...discussion, __typename: "Discussion" };

      const closedAt =
        typeof discussion.closedAt === "string" &&
        discussion.closedAt.trim().length > 0
          ? discussion.closedAt
          : null;
      const normalizedState = closedAt !== null ? "closed" : "open";

      await upsertIssue({
        id: discussion.id,
        number: discussion.number,
        repositoryId: repository.id,
        authorId: authorId ?? null,
        title: discussion.title,
        state: normalizedState,
        createdAt: discussion.createdAt,
        updatedAt: discussion.updatedAt,
        closedAt,
        raw: rawDiscussion,
      });

      await processReactions(discussion.reactions, "discussion", discussion.id);

      latestDiscussionUpdated = maxTimestamp(
        latestDiscussionUpdated,
        discussion.updatedAt,
      );
      discussionCount += 1;
      upsertedDiscussionCount += 1;

      const commentsResult = await collectIssueComments(
        client,
        repository,
        discussion,
        options,
        "discussion",
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        commentsResult.latest,
      );
      commentCount += commentsResult.count;
    }

    const cursorLabel = cursor ? ` (cursor ${cursor})` : "";
    const summary = `Processed discussions batch for ${repository.nameWithOwner}${cursorLabel}: fetched ${fetchedDiscussionCount}, upserted ${upsertedDiscussionCount}`;

    if (reachedLowerBound) {
      logger?.(`${summary} (stopped at lower bound)`);
      hasNextPage = false;
      cursor = null;
      break;
    }

    logger?.(`${summary}.`);

    hasNextPage = discussionsConnection?.pageInfo?.hasNextPage ?? false;
    cursor = discussionsConnection?.pageInfo?.endCursor ?? null;
  }

  return {
    latestDiscussionUpdated,
    latestCommentUpdated,
    discussionCount,
    commentCount,
  };
}

async function collectReviewComments(
  client: GraphQLClient,
  repository: RepositoryNode,
  pullRequest: PullRequestNode,
  options: SyncOptions,
  reviewCache: Set<string>,
): Promise<CommentCollectionResult> {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "comments");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  let cursor: string | null = null;
  let hasNextPage = true;
  let latest: string | null = null;
  let count = 0;
  const [owner, name] = repository.nameWithOwner.split("/");

  while (hasNextPage) {
    logger?.(
      `Fetching review comments for ${repository.nameWithOwner} PR #${pullRequest.number}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    const data: PullRequestReviewCommentsQueryResponse = await requestWithRetry(
      client,
      pullRequestReviewCommentsQuery,
      {
        owner,
        name,
        number: pullRequest.number,
        cursor,
      },
      {
        logger,
        context: `review threads ${repository.nameWithOwner}#${pullRequest.number}`,
      },
    );

    const threads = data.repository?.pullRequest?.reviewThreads;
    const threadNodes = threads?.nodes ?? [];
    let reachedUpperBound = false;

    for (const thread of threadNodes) {
      for (const comment of (thread.comments?.nodes ?? []) as CommentNode[]) {
        const timestamp = comment.updatedAt ?? comment.createdAt;
        const decision = evaluateTimestamp(timestamp, bounds);
        if (!decision.include) {
          if (decision.afterUpperBound) {
            reachedUpperBound = true;
            break;
          }
          continue;
        }

        const authorId = await processActor(comment.author);
        let reviewId: string | null = null;
        const potentialReviewId = comment.pullRequestReview?.id ?? null;
        if (potentialReviewId) {
          if (reviewCache.has(potentialReviewId)) {
            reviewId = potentialReviewId;
          } else if (await reviewExists(potentialReviewId)) {
            reviewCache.add(potentialReviewId);
            reviewId = potentialReviewId;
          } else {
            logger?.(
              `Review ${potentialReviewId} referenced by comment ${comment.id} was not found. Saving without review reference.`,
            );
          }
        }

        await upsertComment({
          id: comment.id,
          issueId: null,
          pullRequestId: pullRequest.id,
          reviewId,
          authorId: authorId ?? null,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt ?? null,
          raw: comment,
        });

        const reactionSubjectType = resolveCommentReactionSubjectType(
          "pull_request",
          comment,
        );
        await processReactions(
          comment.reactions,
          reactionSubjectType,
          comment.id,
        );

        latest = maxTimestamp(latest, timestamp);
        count += 1;
      }
      if (reachedUpperBound) {
        break;
      }
    }

    if (reachedUpperBound) {
      hasNextPage = false;
      cursor = null;
      break;
    }

    hasNextPage = threads?.pageInfo?.hasNextPage ?? false;
    cursor = threads?.pageInfo?.endCursor ?? null;
  }

  return { latest, count };
}

async function collectReviews(
  client: GraphQLClient,
  repository: RepositoryNode,
  pullRequest: PullRequestNode,
  options: SyncOptions,
): Promise<ReviewCollectionResult> {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "reviews");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  let cursor: string | null = null;
  let hasNextPage = true;
  let latest: string | null = null;
  let count = 0;
  const reviewIds = new Set<string>();
  const [owner, name] = repository.nameWithOwner.split("/");

  while (hasNextPage) {
    logger?.(
      `Fetching reviews for ${repository.nameWithOwner} PR #${pullRequest.number}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    const data: PullRequestReviewsQueryResponse = await requestWithRetry(
      client,
      pullRequestReviewsQuery,
      {
        owner,
        name,
        number: pullRequest.number,
        cursor,
      },
      {
        logger,
        context: `reviews ${repository.nameWithOwner}#${pullRequest.number}`,
      },
    );

    const reviewsConnection = data.repository?.pullRequest?.reviews;
    const reviewNodes: ReviewNode[] = reviewsConnection?.nodes ?? [];
    let reachedUpperBound = false;

    for (const review of reviewNodes) {
      const timestamp = review.submittedAt ?? null;
      const decision = evaluateTimestamp(timestamp, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          reachedUpperBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(review.author);
      await upsertReview({
        id: review.id,
        pullRequestId: pullRequest.id,
        authorId: authorId ?? null,
        state: review.state ?? null,
        submittedAt: review.submittedAt ?? null,
        raw: review,
      });

      reviewIds.add(review.id);
      latest = maxTimestamp(latest, timestamp);
      count += 1;
    }

    if (reachedUpperBound) {
      hasNextPage = false;
      cursor = null;
      break;
    }

    hasNextPage = reviewsConnection?.pageInfo?.hasNextPage ?? false;
    cursor = reviewsConnection?.pageInfo?.endCursor ?? null;
  }

  return { latest, count, reviewIds };
}

async function collectIssuesForRepository(
  client: GraphQLClient,
  repository: RepositoryNode,
  options: SyncOptions,
) {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "issues");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  let cursor: string | null = null;
  let hasNextPage = true;
  const [owner, name] = repository.nameWithOwner.split("/");
  let latestIssueUpdated: string | null = null;
  let latestCommentUpdated: string | null = null;
  let issueCount = 0;
  let commentCount = 0;

  while (hasNextPage) {
    logger?.(
      `Fetching issues for ${repository.nameWithOwner}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    const data: RepositoryIssuesQueryResponse = await requestWithRetry(
      client,
      repositoryIssuesQuery,
      {
        owner,
        name,
        cursor,
        since: effectiveSince,
      },
      {
        logger,
        context: `issues ${repository.nameWithOwner}`,
      },
    );

    const issuesConnection = data.repository?.issues;
    const issueNodes: IssueNode[] = issuesConnection?.nodes ?? [];
    const fetchedIssueCount = issueNodes.length;
    let upsertedIssueCount = 0;
    const existingIssueRaw = issueNodes.length
      ? await fetchIssueRawMap(issueNodes.map((node) => node.id))
      : new Map<string, unknown>();
    let reachedUpperBound = false;

    for (const issue of issueNodes) {
      const decision = evaluateTimestamp(issue.updatedAt, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          reachedUpperBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(issue.author);
      await processActorNodes(issue.assignees?.nodes);
      const previousHistory = extractProjectStatusHistoryFromRaw(
        existingIssueRaw.get(issue.id),
      );
      const snapshots = collectProjectStatusSnapshots(issue);
      const removals = createRemovalEntries(
        previousHistory,
        snapshots,
        typeof issue.updatedAt === "string" ? issue.updatedAt : null,
      );
      const mergedHistory = mergeProjectStatusHistory(previousHistory, [
        ...snapshots,
        ...removals,
      ]);
      if (
        TARGET_TODO_PROJECT &&
        mergedHistory.some((entry) => isTargetProject(entry.projectTitle))
      ) {
        await clearActivityStatuses(issue.id);
        await clearProjectFieldOverrides(issue.id);
      }
      const rawIssue =
        mergedHistory.length > 0
          ? { ...issue, projectStatusHistory: mergedHistory }
          : issue;

      await upsertIssue({
        id: issue.id,
        number: issue.number,
        repositoryId: repository.id,
        authorId: authorId ?? null,
        title: issue.title,
        state: issue.state,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt ?? null,
        raw: rawIssue,
      });
      upsertedIssueCount += 1;

      await processReactions(issue.reactions, "issue", issue.id);

      latestIssueUpdated = maxTimestamp(latestIssueUpdated, issue.updatedAt);
      issueCount += 1;

      const commentsResult = await collectIssueComments(
        client,
        repository,
        issue,
        options,
        "issue",
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        commentsResult.latest,
      );
      commentCount += commentsResult.count;
    }

    const cursorLabel = cursor ? ` (cursor ${cursor})` : "";
    const summary = `Processed issues batch for ${repository.nameWithOwner}${cursorLabel}: fetched ${fetchedIssueCount}, upserted ${upsertedIssueCount}`;

    if (reachedUpperBound) {
      logger?.(`${summary} (stopped at upper bound)`);
      hasNextPage = false;
      cursor = null;
      break;
    }

    logger?.(`${summary}.`);

    hasNextPage = issuesConnection?.pageInfo?.hasNextPage ?? false;
    cursor = issuesConnection?.pageInfo?.endCursor ?? null;
  }

  return { latestIssueUpdated, latestCommentUpdated, issueCount, commentCount };
}

async function collectPullRequestsForRepository(
  client: GraphQLClient,
  repository: RepositoryNode,
  options: SyncOptions,
) {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "pull_requests");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  let cursor: string | null = null;
  let hasNextPage = true;
  const [owner, name] = repository.nameWithOwner.split("/");
  let latestPullRequestUpdated: string | null = null;
  let latestReviewSubmitted: string | null = null;
  let latestCommentUpdated: string | null = null;
  let pullRequestCount = 0;
  let reviewCount = 0;
  let commentCount = 0;
  const reviewCache = new Set<string>();

  while (hasNextPage) {
    logger?.(
      `Fetching pull requests for ${repository.nameWithOwner}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    const data: RepositoryPullRequestsQueryResponse = await requestWithRetry(
      client,
      repositoryPullRequestsQuery,
      {
        owner,
        name,
        cursor,
      },
      {
        logger,
        context: `pull requests ${repository.nameWithOwner}`,
      },
    );

    const prsConnection = data.repository?.pullRequests;
    const prNodes: PullRequestNode[] = prsConnection?.nodes ?? [];
    const fetchedPullRequestCount = prNodes.length;
    let upsertedPullRequestCount = 0;
    let reachedLowerBound = false;

    for (const pullRequest of prNodes) {
      const decision = evaluateTimestamp(pullRequest.updatedAt, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          continue;
        }
        if (decision.beforeLowerBound) {
          reachedLowerBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(pullRequest.author);
      await processActor(pullRequest.mergedBy);
      await processActorNodes(pullRequest.assignees?.nodes);
      await upsertPullRequest({
        id: pullRequest.id,
        number: pullRequest.number,
        repositoryId: repository.id,
        authorId: authorId ?? null,
        title: pullRequest.title,
        state: pullRequest.state,
        createdAt: pullRequest.createdAt,
        updatedAt: pullRequest.updatedAt,
        closedAt: pullRequest.closedAt ?? null,
        mergedAt: pullRequest.mergedAt ?? null,
        merged: pullRequest.merged ?? null,
        raw: pullRequest,
      });
      upsertedPullRequestCount += 1;

      const closingIssuesNodes = (pullRequest.closingIssuesReferences?.nodes ??
        []) as IssueRelationNode[];
      const closingIssues = closingIssuesNodes
        .filter((issue): issue is IssueRelationNode =>
          Boolean(issue && typeof issue.id === "string"),
        )
        .map((issue) => ({
          issueId: issue.id,
          issueNumber: typeof issue.number === "number" ? issue.number : null,
          issueTitle: issue.title ?? null,
          issueState: issue.state ?? null,
          issueUrl: issue.url ?? null,
          issueRepository:
            typeof issue.repository?.nameWithOwner === "string"
              ? issue.repository.nameWithOwner
              : null,
        }));

      await replacePullRequestIssues(pullRequest.id, closingIssues);

      latestPullRequestUpdated = maxTimestamp(
        latestPullRequestUpdated,
        pullRequest.updatedAt,
      );
      pullRequestCount += 1;

      const issueCommentsResult = await collectIssueComments(
        client,
        repository,
        pullRequest,
        options,
        "pull_request",
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        issueCommentsResult.latest,
      );
      commentCount += issueCommentsResult.count;

      const reviewResult = await collectReviews(
        client,
        repository,
        pullRequest,
        options,
      );
      latestReviewSubmitted = maxTimestamp(
        latestReviewSubmitted,
        reviewResult.latest,
      );
      reviewCount += reviewResult.count;
      for (const id of reviewResult.reviewIds) {
        reviewCache.add(id);
      }

      const reviewCommentResult = await collectReviewComments(
        client,
        repository,
        pullRequest,
        options,
        reviewCache,
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        reviewCommentResult.latest,
      );
      commentCount += reviewCommentResult.count;
    }

    const cursorLabel = cursor ? ` (cursor ${cursor})` : "";
    const summary = `Processed pull request batch for ${repository.nameWithOwner}${cursorLabel}: fetched ${fetchedPullRequestCount}, upserted ${upsertedPullRequestCount}`;

    if (reachedLowerBound) {
      logger?.(`${summary} (stopped at lower bound)`);
      hasNextPage = false;
      cursor = null;
      break;
    }

    logger?.(`${summary}.`);

    hasNextPage = prsConnection?.pageInfo?.hasNextPage ?? false;
    cursor = prsConnection?.pageInfo?.endCursor ?? null;
  }

  return {
    latestPullRequestUpdated,
    latestReviewSubmitted,
    latestCommentUpdated,
    pullRequestCount,
    reviewCount,
    commentCount,
  };
}

async function refreshOpenIssuesMetadataForRepository(
  client: GraphQLClient,
  repository: RepositoryNode,
  options: SyncOptions,
) {
  const [owner, name] = repository.nameWithOwner.split("/");
  let cursor: string | null = null;
  let hasNextPage = true;
  let count = 0;

  while (hasNextPage) {
    const data: OpenIssueMetadataQueryResponse = await requestWithRetry(
      client,
      openIssueMetadataQuery,
      {
        owner,
        name,
        cursor,
      },
      {
        logger: options.logger,
        context: `open issues ${repository.nameWithOwner}`,
      },
    );

    const connection = data.repository?.issues;
    const nodes = connection?.nodes ?? [];
    for (const issue of nodes) {
      await processActorNodes(issue.assignees?.nodes);
      await updateIssueAssignees(
        issue.id,
        buildAssigneesPayload(issue.assignees ?? null),
      );
      count += 1;
    }

    hasNextPage = connection?.pageInfo?.hasNextPage ?? false;
    cursor = connection?.pageInfo?.endCursor ?? null;
  }

  return count;
}

async function refreshOpenPullRequestMetadataForRepository(
  client: GraphQLClient,
  repository: RepositoryNode,
  options: SyncOptions,
) {
  const [owner, name] = repository.nameWithOwner.split("/");
  let cursor: string | null = null;
  let hasNextPage = true;
  let pullRequestCount = 0;
  let reviewRequestsAdded = 0;
  let reviewRequestsRemoved = 0;

  while (hasNextPage) {
    const data: OpenPullRequestMetadataQueryResponse = await requestWithRetry(
      client,
      openPullRequestMetadataQuery,
      {
        owner,
        name,
        cursor,
      },
      {
        logger: options.logger,
        context: `open pull requests ${repository.nameWithOwner}`,
      },
    );

    const connection = data.repository?.pullRequests;
    const nodes = connection?.nodes ?? [];
    const pendingRequests = nodes.length
      ? await listPendingReviewRequestsByPullRequestIds(
          nodes.map((node) => node.id),
        )
      : new Map();

    for (const pullRequest of nodes) {
      await processActorNodes(pullRequest.assignees?.nodes);
      await updatePullRequestAssignees(
        pullRequest.id,
        buildAssigneesPayload(pullRequest.assignees ?? null),
      );
      const reviewCounts = await syncReviewRequestsSnapshot(
        pullRequest,
        pendingRequests.get(pullRequest.id),
      );
      reviewRequestsAdded += reviewCounts.added;
      reviewRequestsRemoved += reviewCounts.removed;
      pullRequestCount += 1;
    }

    hasNextPage = connection?.pageInfo?.hasNextPage ?? false;
    cursor = connection?.pageInfo?.endCursor ?? null;
  }

  return {
    pullRequests: pullRequestCount,
    reviewRequestsAdded,
    reviewRequestsRemoved,
  };
}

async function refreshOpenItemMetadata(
  client: GraphQLClient,
  repositories: RepositoryNode[],
  options: SyncOptions,
) {
  let openIssues = 0;
  let openPullRequests = 0;
  let totalReviewRequestsAdded = 0;
  let totalReviewRequestsRemoved = 0;
  const { logger } = options;

  logger?.(
    `[open-items] Refreshing metadata for ${repositories.length} repository${repositories.length === 1 ? "" : "ies"}.`,
  );

  for (const repository of repositories) {
    const issuesUpdated = await refreshOpenIssuesMetadataForRepository(
      client,
      repository,
      options,
    );
    openIssues += issuesUpdated;
    const pullRequestResult = await refreshOpenPullRequestMetadataForRepository(
      client,
      repository,
      options,
    );
    openPullRequests += pullRequestResult.pullRequests;
    totalReviewRequestsAdded += pullRequestResult.reviewRequestsAdded;
    totalReviewRequestsRemoved += pullRequestResult.reviewRequestsRemoved;

    logger?.(
      `[open-items] ${repository.nameWithOwner}: refreshed ${issuesUpdated} open issue${issuesUpdated === 1 ? "" : "s"} and ${pullRequestResult.pullRequests} open pull request${pullRequestResult.pullRequests === 1 ? "" : "s"} (review requests +${pullRequestResult.reviewRequestsAdded}, -${pullRequestResult.reviewRequestsRemoved}).`,
    );
  }

  logger?.(
    `[open-items] Completed metadata refresh (${openIssues} issues, ${openPullRequests} pull requests, review requests +${totalReviewRequestsAdded}, -${totalReviewRequestsRemoved}).`,
  );

  return {
    openIssues,
    openPullRequests,
    reviewRequestsAdded: totalReviewRequestsAdded,
    reviewRequestsRemoved: totalReviewRequestsRemoved,
  };
}

async function collectPullRequestLinksForRepository(
  client: GraphQLClient,
  repository: RepositoryNode,
  options: SyncOptions,
) {
  const { logger } = options;
  const effectiveSince = resolveSince(options, "pull_requests");
  const effectiveUntil = resolveUntil(options);
  const bounds = createBounds(effectiveSince, effectiveUntil);
  let cursor: string | null = null;
  let hasNextPage = true;
  const [owner, name] = repository.nameWithOwner.split("/");
  let latestPullRequestUpdated: string | null = null;
  let pullRequestCount = 0;

  while (hasNextPage) {
    const cursorLabel = cursor ? ` (cursor ${cursor})` : "";
    const boundsLabel = formatBoundsForLog(bounds);
    logger?.(
      `Fetching pull request links for ${repository.nameWithOwner}${cursorLabel}${boundsLabel}`,
    );

    const data: RepositoryPullRequestLinksQueryResponse =
      await requestWithRetry(
        client,
        repositoryPullRequestLinksQuery,
        {
          owner,
          name,
          cursor,
        },
        {
          logger,
          context: `pull request links ${repository.nameWithOwner}`,
        },
      );

    const prsConnection = data.repository?.pullRequests;
    const prNodes: PullRequestLinkNode[] = prsConnection?.nodes ?? [];
    const fetchedPullRequestLinkCount = prNodes.length;
    let upsertedPullRequestLinkCount = 0;
    let reachedLowerBound = false;

    for (const pullRequest of prNodes) {
      const decision = evaluateTimestamp(pullRequest.updatedAt, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          continue;
        }
        if (decision.beforeLowerBound) {
          reachedLowerBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(pullRequest.author);
      await processActor(pullRequest.mergedBy);
      await processActorNodes(pullRequest.assignees?.nodes);
      await upsertPullRequest({
        id: pullRequest.id,
        number: pullRequest.number,
        repositoryId: repository.id,
        authorId: authorId ?? null,
        title: pullRequest.title,
        state: pullRequest.state,
        createdAt: pullRequest.createdAt,
        updatedAt: pullRequest.updatedAt,
        closedAt: pullRequest.closedAt ?? null,
        mergedAt: pullRequest.mergedAt ?? null,
        merged: pullRequest.merged ?? null,
        raw: pullRequest,
      });
      upsertedPullRequestLinkCount += 1;

      const closingIssuesNodes = (pullRequest.closingIssuesReferences?.nodes ??
        []) as IssueRelationNode[];
      const closingIssues = closingIssuesNodes
        .filter((issue): issue is IssueRelationNode =>
          Boolean(issue && typeof issue.id === "string"),
        )
        .map((issue) => ({
          issueId: issue.id,
          issueNumber: typeof issue.number === "number" ? issue.number : null,
          issueTitle: issue.title ?? null,
          issueState: issue.state ?? null,
          issueUrl: issue.url ?? null,
          issueRepository:
            typeof issue.repository?.nameWithOwner === "string"
              ? issue.repository.nameWithOwner
              : null,
        }));

      await replacePullRequestIssues(pullRequest.id, closingIssues);

      latestPullRequestUpdated = maxTimestamp(
        latestPullRequestUpdated,
        pullRequest.updatedAt,
      );
      pullRequestCount += 1;
    }

    const nextCursor = prsConnection?.pageInfo?.endCursor ?? null;
    const nextCursorLabel = nextCursor ? ` (cursor ${nextCursor})` : "";
    const summary = `Processed pull request link batch for ${repository.nameWithOwner}${nextCursorLabel}: fetched ${fetchedPullRequestLinkCount}, upserted ${upsertedPullRequestLinkCount}`;

    if (reachedLowerBound) {
      logger?.(`${summary} (stopped at lower bound)`);
      hasNextPage = false;
      cursor = nextCursor;
      break;
    }

    logger?.(`${summary}.`);

    hasNextPage = prsConnection?.pageInfo?.hasNextPage ?? false;
    cursor = nextCursor;
  }

  return {
    latestPullRequestUpdated,
    pullRequestCount,
  };
}

async function collectRepositories(
  client: GraphQLClient,
  options: SyncOptions,
): Promise<{ repositories: RepositoryNode[]; latestUpdated: string | null }> {
  const { org, logger } = options;
  let cursor: string | null = null;
  let hasNextPage = true;
  const repositories: RepositoryNode[] = [];
  let latestUpdated: string | null = null;

  while (hasNextPage) {
    logger?.(
      `Fetching repositories for ${org}${cursor ? ` (cursor ${cursor})` : ""}`,
    );
    const data: OrganizationRepositoriesQueryResponse = await requestWithRetry(
      client,
      organizationRepositoriesQuery,
      {
        login: org,
        cursor,
      },
      {
        logger,
        context: `repositories for ${org}`,
      },
    );

    const repositoriesConnection = data.organization?.repositories;
    const nodes: RepositoryNode[] = repositoriesConnection?.nodes ?? [];

    for (const repository of nodes) {
      const ownerId = await processActor(repository.owner);
      await upsertRepository({
        id: repository.id,
        name: repository.name,
        nameWithOwner: repository.nameWithOwner,
        url: repository.url,
        isPrivate: repository.isPrivate,
        createdAt: repository.createdAt,
        updatedAt: repository.updatedAt,
        ownerId: ownerId ?? null,
        raw: repository,
      });

      repositories.push(repository);
      latestUpdated = maxTimestamp(latestUpdated, repository.updatedAt);
    }

    hasNextPage = repositoriesConnection?.pageInfo?.hasNextPage ?? false;
    cursor = repositoriesConnection?.pageInfo?.endCursor ?? null;
  }

  return { repositories, latestUpdated };
}

export async function runCollection(options: SyncOptions) {
  if (!options.org) {
    throw new Error("GitHub organization is not configured.");
  }

  const client = options.client ?? createGithubClient();
  const runId = options.runId ?? null;
  const repoLogId = ensureLogId(
    await recordSyncLog("repositories", "running", undefined, runId),
  );
  let repositories: RepositoryNode[] = [];
  let repositoriesLatest: string | null = null;

  try {
    const repositoryResult = await collectRepositories(client, options);
    repositories = repositoryResult.repositories;
    repositoriesLatest = repositoryResult.latestUpdated;

    if (repositoriesLatest) {
      await updateSyncState("repositories", null, repositoriesLatest);
    }

    await updateSyncLog(
      repoLogId,
      "success",
      `Processed ${repositories.length} repositories for ${options.org}.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while collecting repositories.";
    await updateSyncLog(repoLogId, "failed", message);
    throw error;
  }

  let latestIssueUpdated: string | null = null;
  let latestDiscussionUpdated: string | null = null;
  let latestPullRequestUpdated: string | null = null;
  let latestReviewSubmitted: string | null = null;
  let latestCommentUpdated: string | null = null;
  let totalIssues = 0;
  let totalDiscussions = 0;
  let totalPullRequests = 0;
  let totalReviews = 0;
  let totalComments = 0;

  const commentLogId = ensureLogId(
    await recordSyncLog("comments", "running", undefined, runId),
  );
  const issuesLogId = ensureLogId(
    await recordSyncLog("issues", "running", undefined, runId),
  );

  try {
    for (const repository of repositories) {
      const issuesResult = await collectIssuesForRepository(
        client,
        repository,
        options,
      );
      latestIssueUpdated = maxTimestamp(
        latestIssueUpdated,
        issuesResult.latestIssueUpdated,
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        issuesResult.latestCommentUpdated,
      );
      totalIssues += issuesResult.issueCount;
      totalComments += issuesResult.commentCount;
    }

    if (latestIssueUpdated) {
      await updateSyncState("issues", null, latestIssueUpdated);
    }

    await updateSyncLog(
      issuesLogId,
      "success",
      `Upserted ${totalIssues} issues across ${repositories.length} repositories.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while collecting issues.";
    await updateSyncLog(issuesLogId, "failed", message);
    await updateSyncLog(commentLogId, "failed", message);
    throw error;
  }

  const discussionsLogId = ensureLogId(
    await recordSyncLog("discussions", "running", undefined, runId),
  );

  try {
    for (const repository of repositories) {
      const discussionsResult = await collectDiscussionsForRepository(
        client,
        repository,
        options,
      );
      latestDiscussionUpdated = maxTimestamp(
        latestDiscussionUpdated,
        discussionsResult.latestDiscussionUpdated,
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        discussionsResult.latestCommentUpdated,
      );
      totalDiscussions += discussionsResult.discussionCount;
      totalComments += discussionsResult.commentCount;
    }

    if (latestDiscussionUpdated) {
      await updateSyncState("discussions", null, latestDiscussionUpdated);
    }

    await updateSyncLog(
      discussionsLogId,
      "success",
      `Upserted ${totalDiscussions} discussions across ${repositories.length} repositories.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while collecting discussions.";
    await updateSyncLog(discussionsLogId, "failed", message);
    await updateSyncLog(commentLogId, "failed", message);
    throw error;
  }

  const pullRequestLogId = ensureLogId(
    await recordSyncLog("pull_requests", "running", undefined, runId),
  );
  const reviewLogId = ensureLogId(
    await recordSyncLog("reviews", "running", undefined, runId),
  );
  const openMetadataLogId = ensureLogId(
    await recordSyncLog(
      "open_items",
      "running",
      "Refreshing open issue and pull request metadata",
      runId,
    ),
  );
  let openMetadataLogCompleted = false;

  try {
    for (const repository of repositories) {
      const prsResult = await collectPullRequestsForRepository(
        client,
        repository,
        options,
      );
      latestPullRequestUpdated = maxTimestamp(
        latestPullRequestUpdated,
        prsResult.latestPullRequestUpdated,
      );
      latestReviewSubmitted = maxTimestamp(
        latestReviewSubmitted,
        prsResult.latestReviewSubmitted,
      );
      latestCommentUpdated = maxTimestamp(
        latestCommentUpdated,
        prsResult.latestCommentUpdated,
      );
      totalPullRequests += prsResult.pullRequestCount;
      totalReviews += prsResult.reviewCount;
      totalComments += prsResult.commentCount;
    }

    try {
      const metadataResult = await refreshOpenItemMetadata(
        client,
        repositories,
        options,
      );
      await updateSyncLog(
        openMetadataLogId,
        "success",
        `Refreshed metadata for ${metadataResult.openIssues} open issues and ${metadataResult.openPullRequests} open pull requests (review requests +${metadataResult.reviewRequestsAdded}, -${metadataResult.reviewRequestsRemoved}).`,
      );
      openMetadataLogCompleted = true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected error while refreshing open item metadata.";
      await updateSyncLog(openMetadataLogId, "failed", message);
      openMetadataLogCompleted = true;
      throw error;
    }

    if (latestPullRequestUpdated) {
      await updateSyncState("pull_requests", null, latestPullRequestUpdated);
    }

    if (latestReviewSubmitted) {
      await updateSyncState("reviews", null, latestReviewSubmitted);
    }

    await updateSyncLog(
      pullRequestLogId,
      "success",
      `Upserted ${totalPullRequests} pull requests across ${repositories.length} repositories.`,
    );

    await updateSyncLog(
      reviewLogId,
      "success",
      `Recorded ${totalReviews} pull request reviews.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while collecting pull requests.";
    await updateSyncLog(pullRequestLogId, "failed", message);
    await updateSyncLog(reviewLogId, "failed", message);
    if (!openMetadataLogCompleted) {
      await updateSyncLog(openMetadataLogId, "failed", message);
    }
    await updateSyncLog(commentLogId, "failed", message);
    throw error;
  }

  if (latestCommentUpdated) {
    await updateSyncState("comments", null, latestCommentUpdated);
  }

  await updateSyncLog(
    commentLogId,
    "success",
    `Captured ${totalComments} comments from issues, discussions, pull requests, and reviews.`,
  );

  return {
    repositoriesProcessed: repositories.length,
    counts: {
      issues: totalIssues,
      discussions: totalDiscussions,
      pullRequests: totalPullRequests,
      reviews: totalReviews,
      comments: totalComments,
    },
    timestamps: {
      repositories: repositoriesLatest,
      issues: latestIssueUpdated,
      discussions: latestDiscussionUpdated,
      pullRequests: latestPullRequestUpdated,
      reviews: latestReviewSubmitted,
      comments: latestCommentUpdated,
    },
  };
}

export async function collectDiscussionsOnly(
  options: SyncOptions & { repositoryNames?: string[] | null },
) {
  if (!options.org) {
    throw new Error("GitHub organization is not configured.");
  }

  const client = options.client ?? createGithubClient();
  const { repositories } = await collectRepositories(client, options);

  let targetRepositories = repositories;
  if (options.repositoryNames?.length) {
    const nameSet = new Set(
      options.repositoryNames.map((value) => value.toLowerCase()),
    );
    targetRepositories = repositories.filter((repository) => {
      const name = repository.name.toLowerCase();
      const nameWithOwner = repository.nameWithOwner.toLowerCase();
      return nameSet.has(name) || nameSet.has(nameWithOwner);
    });
  }

  let latestDiscussionUpdated: string | null = null;
  let latestCommentUpdated: string | null = null;
  let discussionCount = 0;
  let commentCount = 0;

  for (const repository of targetRepositories) {
    const result = await collectDiscussionsForRepository(
      client,
      repository,
      options,
    );
    latestDiscussionUpdated = maxTimestamp(
      latestDiscussionUpdated,
      result.latestDiscussionUpdated,
    );
    latestCommentUpdated = maxTimestamp(
      latestCommentUpdated,
      result.latestCommentUpdated,
    );
    discussionCount += result.discussionCount;
    commentCount += result.commentCount;
  }

  if (latestDiscussionUpdated) {
    await updateSyncState("discussions", null, latestDiscussionUpdated);
  }
  if (latestCommentUpdated) {
    await updateSyncState("comments", null, latestCommentUpdated);
  }

  return {
    repositoriesProcessed: targetRepositories.length,
    discussionCount,
    commentCount,
    latestDiscussionUpdated,
    latestCommentUpdated,
  };
}

async function ensureRepositoryRecord(repository?: RepositoryNode | null) {
  if (!repository) {
    throw new Error("Repository information is missing for this node.");
  }
  if (repository.owner) {
    await processActor(repository.owner);
  }
  await upsertRepository({
    id: repository.id,
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
    ownerId: repository.owner?.id ?? null,
    url: repository.url ?? null,
    isPrivate: repository.isPrivate ?? null,
    createdAt: repository.createdAt ?? null,
    updatedAt: repository.updatedAt ?? null,
    raw: repository,
  });
  return repository;
}

async function reimportIssueNodeData(params: {
  client: GraphQLClient;
  repository: RepositoryNode;
  issue: IssueNode;
  options: SyncOptions;
}) {
  const { client, repository, issue, options } = params;
  try {
    const authorId = await processActor(issue.author);
    await processActorNodes(issue.assignees?.nodes);
    const existingIssueRaw = await fetchIssueRawMap([issue.id]);
    const previousHistory = extractProjectStatusHistoryFromRaw(
      existingIssueRaw.get(issue.id),
    );
    const snapshots = collectProjectStatusSnapshots(issue);
    const removals = createRemovalEntries(
      previousHistory,
      snapshots,
      typeof issue.updatedAt === "string" ? issue.updatedAt : null,
    );
    const mergedHistory = mergeProjectStatusHistory(previousHistory, [
      ...snapshots,
      ...removals,
    ]);
    if (
      TARGET_TODO_PROJECT &&
      mergedHistory.some((entry) => isTargetProject(entry.projectTitle))
    ) {
      await clearActivityStatuses(issue.id);
      await clearProjectFieldOverrides(issue.id);
    }
    const rawIssue =
      mergedHistory.length > 0
        ? { ...issue, projectStatusHistory: mergedHistory }
        : issue;

    await upsertIssue({
      id: issue.id,
      number: issue.number,
      repositoryId: repository.id,
      authorId: authorId ?? null,
      title: issue.title,
      state: issue.state,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      closedAt: issue.closedAt ?? null,
      raw: rawIssue,
    });

    await processReactions(issue.reactions, "issue", issue.id);

    await collectIssueComments(client, repository, issue, options, "issue");
  } catch (error) {
    throw wrapGithubError(
      error,
      `Failed to re-import issue ${issue.number ?? issue.id}`,
    );
  }
}

async function reimportDiscussionNodeData(params: {
  client: GraphQLClient;
  repository: RepositoryNode;
  discussion: DiscussionNode;
  options: SyncOptions;
}) {
  const { client, repository, discussion, options } = params;
  try {
    const authorId = await processActor(discussion.author);
    await processActor(discussion.answerChosenBy);
    const rawDiscussion =
      typeof discussion.__typename === "string" &&
      discussion.__typename.length > 0
        ? discussion
        : { ...discussion, __typename: "Discussion" };
    const closedAt =
      typeof discussion.closedAt === "string" &&
      discussion.closedAt.trim().length > 0
        ? discussion.closedAt
        : null;
    const normalizedState = closedAt !== null ? "closed" : "open";

    await upsertIssue({
      id: discussion.id,
      number: discussion.number,
      repositoryId: repository.id,
      authorId: authorId ?? null,
      title: discussion.title,
      state: normalizedState,
      createdAt: discussion.createdAt,
      updatedAt: discussion.updatedAt,
      closedAt,
      raw: rawDiscussion,
    });

    await processReactions(discussion.reactions, "discussion", discussion.id);

    await collectIssueComments(
      client,
      repository,
      discussion,
      options,
      "discussion",
    );
  } catch (error) {
    throw wrapGithubError(
      error,
      `Failed to re-import discussion ${discussion.number ?? discussion.id}`,
    );
  }
}

async function reimportPullRequestNodeData(params: {
  client: GraphQLClient;
  repository: RepositoryNode;
  pullRequest: PullRequestNode;
  options: SyncOptions;
}) {
  const { client, repository, pullRequest, options } = params;
  try {
    const authorId = await processActor(pullRequest.author);
    await processActor(pullRequest.mergedBy);
    await processActorNodes(pullRequest.assignees?.nodes);
    await upsertPullRequest({
      id: pullRequest.id,
      number: pullRequest.number,
      repositoryId: repository.id,
      authorId: authorId ?? null,
      title: pullRequest.title,
      state: pullRequest.state,
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
      closedAt: pullRequest.closedAt ?? null,
      mergedAt: pullRequest.mergedAt ?? null,
      merged: pullRequest.merged ?? null,
      raw: pullRequest,
    });

    const closingIssuesNodes = (pullRequest.closingIssuesReferences?.nodes ??
      []) as IssueRelationNode[];
    const closingIssues = closingIssuesNodes
      .filter((issue): issue is IssueRelationNode =>
        Boolean(issue && typeof issue.id === "string"),
      )
      .map((issue) => ({
        issueId: issue.id,
        issueNumber: typeof issue.number === "number" ? issue.number : null,
        issueTitle: issue.title ?? null,
        issueState: issue.state ?? null,
        issueUrl: issue.url ?? null,
        issueRepository:
          typeof issue.repository?.nameWithOwner === "string"
            ? issue.repository.nameWithOwner
            : null,
      }));

    await replacePullRequestIssues(pullRequest.id, closingIssues);

    await collectIssueComments(
      client,
      repository,
      pullRequest,
      options,
      "pull_request",
    );

    const reviewResult = await collectReviews(
      client,
      repository,
      pullRequest,
      options,
    );
    const reviewCache = new Set<string>();
    for (const id of reviewResult.reviewIds) {
      reviewCache.add(id);
    }
    await collectReviewComments(
      client,
      repository,
      pullRequest,
      options,
      reviewCache,
    );
  } catch (error) {
    throw wrapGithubError(
      error,
      `Failed to re-import pull request ${pullRequest.number ?? pullRequest.id}`,
    );
  }
}

export async function reimportActivityNode(options: {
  nodeId: string;
  logger?: SyncLogger;
  client?: GraphQLClient;
}) {
  const trimmed = options.nodeId.trim();
  if (!trimmed.length) {
    throw new Error("Node id is required.");
  }
  const client = options.client ?? createGithubClient();
  const { logger } = options;
  let data: ActivityNodeResyncResponse;
  try {
    data = await requestWithRetry<ActivityNodeResyncResponse>(
      client,
      activityNodeResyncQuery,
      { id: trimmed },
      {
        logger,
        context: `node ${trimmed}`,
      },
    );
  } catch (error) {
    throw wrapGithubError(
      error,
      "Failed to load item data from GitHub. Verify that the token has access to the repository.",
    );
  }
  const node = data.node;
  if (!node) {
    throw new Error("GitHub node was not found.");
  }
  if (
    !isIssueResyncNode(node) &&
    !isPullRequestResyncNode(node) &&
    !isDiscussionResyncNode(node)
  ) {
    throw new Error(
      "Only issues, pull requests, and discussions are supported.",
    );
  }
  const repository = await ensureRepositoryRecord(node.repository);
  if (!repository.nameWithOwner) {
    throw new Error("Repository name is missing for this node.");
  }
  const org =
    repository.nameWithOwner.split("/")[0]?.trim() ??
    repository.nameWithOwner.trim();
  const syncOptions: SyncOptions = {
    org: org.length ? org : "unknown",
    logger,
    client,
  };
  if (isIssueResyncNode(node)) {
    await reimportIssueNodeData({
      client,
      repository,
      issue: node,
      options: syncOptions,
    });
    return { nodeId: trimmed, type: "issue" as const };
  }
  if (isPullRequestResyncNode(node)) {
    await reimportPullRequestNodeData({
      client,
      repository,
      pullRequest: node,
      options: syncOptions,
    });
    return { nodeId: trimmed, type: "pull_request" as const };
  }
  await reimportDiscussionNodeData({
    client,
    repository,
    discussion: node,
    options: syncOptions,
  });
  return { nodeId: trimmed, type: "discussion" as const };
}

export async function collectPullRequestLinks(options: SyncOptions) {
  if (!options.org) {
    throw new Error("GitHub organization is not configured.");
  }

  const client = options.client ?? createGithubClient();
  const repositoryResult = await collectRepositories(client, options);

  let latestPullRequestUpdated: string | null = null;
  let pullRequestCount = 0;

  for (const repository of repositoryResult.repositories) {
    const result = await collectPullRequestLinksForRepository(
      client,
      repository,
      options,
    );
    latestPullRequestUpdated = maxTimestamp(
      latestPullRequestUpdated,
      result.latestPullRequestUpdated,
    );
    pullRequestCount += result.pullRequestCount;
  }

  if (latestPullRequestUpdated) {
    await updateSyncState("pull_requests", null, latestPullRequestUpdated);
  }

  return {
    repositoriesProcessed: repositoryResult.repositories.length,
    pullRequestCount,
    latestPullRequestUpdated,
  };
}
