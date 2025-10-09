import type { GraphQLClient, RequestDocument } from "graphql-request";
import { ClientError } from "graphql-request";

import { clearActivityStatuses } from "@/lib/activity/status-store";
import {
  fetchIssueRawMap,
  markReviewRequestRemoved,
  recordSyncLog,
  reviewExists,
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
  issueCommentsQuery,
  organizationRepositoriesQuery,
  pullRequestCommentsQuery,
  pullRequestReviewCommentsQuery,
  pullRequestReviewsQuery,
  repositoryIssuesQuery,
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
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
};

type PullRequestNode = IssueNode & {
  mergedAt?: string | null;
  merged?: boolean | null;
  mergedBy?: GithubActor | null;
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
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
  author?: GithubActor | null;
  createdAt: string;
  updatedAt?: string | null;
  pullRequestReview?: { id: string } | null;
  reactions?: {
    nodes: ReactionNode[] | null;
  } | null;
};

type CommentCollectionResult = {
  latest: string | null;
  count: number;
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

type RepositoryPullRequestsQueryResponse = {
  repository: {
    pullRequests: GraphQLConnection<PullRequestNode> | null;
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

export const RESOURCE_KEYS = [
  "repositories",
  "issues",
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

function evaluateTimestamp(
  timestamp: string | null | undefined,
  bounds: TimeBounds,
): {
  include: boolean;
  afterUpperBound: boolean;
} {
  const value = toTime(timestamp);
  if (value === null) {
    return { include: false, afterUpperBound: false };
  }

  if (bounds.since !== null && value < bounds.since) {
    return { include: false, afterUpperBound: false };
  }

  if (bounds.until !== null && value >= bounds.until) {
    return { include: false, afterUpperBound: true };
  }

  return { include: true, afterUpperBound: false };
}

async function processActor(actor: Maybe<GithubActor>) {
  const normalized = toActor(actor);
  if (!normalized) {
    return null;
  }

  await upsertUser(normalized);
  return normalized.id;
}

async function resolveReviewerId(
  reviewer: Maybe<{ id?: string | null; __typename?: string }>,
) {
  if (!reviewer?.id) {
    return null;
  }

  const typename = reviewer.__typename ?? "";
  if (typename === "Team") {
    return null;
  }

  return processActor(reviewer as GithubActor);
}

async function processReactions(
  reactions: Maybe<{ nodes: ReactionNode[] | null }>,
  subjectType: string,
  subjectId: string,
) {
  const reactionNodes = reactions?.nodes ?? [];
  for (const reaction of reactionNodes) {
    if (!reaction?.id) {
      continue;
    }

    const userId = await processActor(reaction.user);
    await upsertReaction({
      id: reaction.id,
      subjectType,
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

type CommentTarget = "issue" | "pull_request";

async function collectIssueComments(
  client: GraphQLClient,
  repository: RepositoryNode,
  issue: IssueNode,
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
  const [owner, name] = repository.nameWithOwner.split("/");

  while (hasNextPage) {
    const logLabel = target === "issue" ? "issue" : "pull request";
    logger?.(
      `Fetching ${logLabel} comments for ${repository.nameWithOwner} #${issue.number}${cursor ? ` (cursor ${cursor})` : ""}`,
    );

    let connection: {
      pageInfo?: PageInfo | null;
      nodes?: CommentNode[] | null;
    } | null = null;
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
          `${logLabel === "issue" ? "Issue" : "Pull request"} ${repository.nameWithOwner} #${issue.number} no longer exists. Skipping comment collection.`,
        );
        break;
      }

      throw error;
    }

    if (!connection) {
      logger?.(
        `${logLabel === "issue" ? "Issue" : "Pull request"} ${repository.nameWithOwner} #${issue.number} was not found. Skipping comment collection.`,
      );
      break;
    }

    const commentNodes: CommentNode[] = connection.nodes ?? [];
    let reachedUpperBound = false;

    for (const comment of commentNodes) {
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
      const isIssueTarget = target === "issue";
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

      await processReactions(comment.reactions, "comment", comment.id);

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

        await processReactions(comment.reactions, "comment", comment.id);

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

    if (reachedUpperBound) {
      hasNextPage = false;
      cursor = null;
      break;
    }

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
    let reachedUpperBound = false;

    for (const pullRequest of prNodes) {
      const decision = evaluateTimestamp(pullRequest.updatedAt, bounds);
      if (!decision.include) {
        if (decision.afterUpperBound) {
          reachedUpperBound = true;
          break;
        }
        continue;
      }

      const authorId = await processActor(pullRequest.author);
      await processActor(pullRequest.mergedBy);
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

      const timeline = Array.isArray(pullRequest.timelineItems?.nodes)
        ? [...(pullRequest.timelineItems?.nodes as PullRequestTimelineItem[])]
        : [];

      timeline.sort((a, b) => {
        const left =
          toTime(typeof a.createdAt === "string" ? a.createdAt : null) ?? 0;
        const right =
          toTime(typeof b.createdAt === "string" ? b.createdAt : null) ?? 0;
        return left - right;
      });

      for (const event of timeline) {
        if (!event || typeof event.__typename !== "string") {
          continue;
        }

        if (event.__typename === "ReviewRequestedEvent") {
          const reviewerId = await resolveReviewerId(event.requestedReviewer);
          if (!reviewerId || typeof event.createdAt !== "string" || !event.id) {
            continue;
          }

          await upsertReviewRequest({
            id: event.id,
            pullRequestId: pullRequest.id,
            reviewerId,
            requestedAt: event.createdAt,
            raw: event,
          });
        } else if (event.__typename === "ReviewRequestRemovedEvent") {
          if (typeof event.createdAt !== "string") {
            continue;
          }
          const reviewerId = await resolveReviewerId(event.requestedReviewer);
          if (!reviewerId) {
            continue;
          }
          await markReviewRequestRemoved({
            pullRequestId: pullRequest.id,
            reviewerId,
            removedAt: event.createdAt,
            raw: event,
          });
        }
      }

      await processReactions(
        pullRequest.reactions,
        "pull_request",
        pullRequest.id,
      );

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

    if (reachedUpperBound) {
      hasNextPage = false;
      cursor = null;
      break;
    }

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
  const repoLogId = ensureLogId(await recordSyncLog("repositories", "running"));
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
  let latestPullRequestUpdated: string | null = null;
  let latestReviewSubmitted: string | null = null;
  let latestCommentUpdated: string | null = null;
  let totalIssues = 0;
  let totalPullRequests = 0;
  let totalReviews = 0;
  let totalComments = 0;

  const commentLogId = ensureLogId(await recordSyncLog("comments", "running"));
  const issuesLogId = ensureLogId(await recordSyncLog("issues", "running"));

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

  const pullRequestLogId = ensureLogId(
    await recordSyncLog("pull_requests", "running"),
  );
  const reviewLogId = ensureLogId(await recordSyncLog("reviews", "running"));

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
    await updateSyncLog(commentLogId, "failed", message);
    throw error;
  }

  if (latestCommentUpdated) {
    await updateSyncState("comments", null, latestCommentUpdated);
  }

  await updateSyncLog(
    commentLogId,
    "success",
    `Captured ${totalComments} comments from issues, pull requests, and reviews.`,
  );

  return {
    repositoriesProcessed: repositories.length,
    counts: {
      issues: totalIssues,
      pullRequests: totalPullRequests,
      reviews: totalReviews,
      comments: totalComments,
    },
    timestamps: {
      repositories: repositoriesLatest,
      issues: latestIssueUpdated,
      pullRequests: latestPullRequestUpdated,
      reviews: latestReviewSubmitted,
      comments: latestCommentUpdated,
    },
  };
}
