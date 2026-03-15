import type { GraphQLClient, RequestDocument } from "graphql-request";
import { ClientError } from "graphql-request";

import {
  deleteReactionsForSubject,
  upsertReaction,
  upsertUser,
} from "@/lib/db/operations";

import type {
  CommentTarget,
  GithubActor,
  Maybe,
  ReactionNode,
  ResourceKey,
  ReviewRequestReviewer,
  SyncLogger,
  SyncOptions,
} from "./types";

export function wrapGithubError(error: unknown, context: string): Error {
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

export type TimeBounds = {
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

export function createBounds(
  since?: string | null,
  until?: string | null,
): TimeBounds {
  return {
    since: toTime(since),
    until: toTime(until),
  };
}

export function formatBoundsForLog(bounds: TimeBounds) {
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

export function evaluateTimestamp(
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

export async function processActor(actor: Maybe<GithubActor>) {
  const normalized = toActor(actor);
  if (!normalized) {
    return null;
  }

  await upsertUser(normalized);
  return normalized.id;
}

export async function processActorNodes(
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

export function buildAssigneesPayload(
  assignees: { nodes?: Maybe<GithubActor>[] | null } | null | undefined,
) {
  return {
    nodes: normalizeAssigneeNodes(assignees?.nodes ?? null),
  };
}

export function reviewerIsUser(
  reviewer: ReviewRequestReviewer | null | undefined,
): reviewer is GithubActor {
  return Boolean(reviewer && reviewer.__typename === "User");
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

export function resolveCommentReactionSubjectType(
  target: CommentTarget,
  comment: {
    __typename?: string | null;
    pullRequestReview?: { id: string } | null;
  },
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

export async function processReactions(
  reactions: Maybe<{ nodes: ReactionNode[] | null }>,
  subjectType: string,
  subjectId: string,
) {
  const reactionNodes = reactions?.nodes ?? [];
  const normalizedSubjectType = normalizeReactionSubjectType(subjectType);
  const collectedIds: string[] = [];
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
    collectedIds.push(reaction.id);
  }

  await deleteReactionsForSubject({
    subjectType: normalizedSubjectType,
    subjectId,
    keepIds: collectedIds,
  });
}

export function maxTimestamp(
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

export function ensureLogId(id: number | undefined) {
  if (typeof id !== "number") {
    throw new Error("Failed to record sync log entry.");
  }

  return id;
}

export function isNotFoundError(error: unknown) {
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

export function describeError(error: unknown) {
  if (error instanceof ClientError) {
    const status = error.response?.status;
    return `status ${status ?? "unknown"}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "unknown error";
}

export async function requestWithRetry<T>(
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

export function resolveSince(options: SyncOptions, resource: ResourceKey) {
  return options.sinceByResource?.[resource] ?? options.since ?? null;
}

export function resolveUntil(options: SyncOptions) {
  return options.until ?? null;
}
