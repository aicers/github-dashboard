import "@/lib/setup-env";

import { setTimeout as sleep } from "node:timers/promises";
import { ClientError } from "graphql-request";

import { closePool, ensureSchema, query } from "@/lib/db";
import { upsertReviewRequest } from "@/lib/db/operations";
import { createGithubClient } from "@/lib/github/client";

type PullRequestRef = {
  id: string;
  number: number;
  owner: string;
  name: string;
  nameWithOwner: string;
};

type ReviewRequestNode = {
  id: string;
  requestedReviewer:
    | {
        __typename: "User";
        id: string;
      }
    | {
        __typename: "Team";
        id: string;
      }
    | null;
};

type ReviewRequestedEventNode = {
  __typename: "ReviewRequestedEvent";
  createdAt: string;
  requestedReviewer:
    | {
        __typename: "User";
        id: string;
      }
    | {
        __typename: "Team";
        id: string;
      }
    | null;
};

type ReviewRequestPage = {
  reviewRequests: {
    nodes: Array<ReviewRequestNode | null> | null;
  } | null;
  timelineItems: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<ReviewRequestedEventNode | null> | null;
  } | null;
};

type ReviewRequestPageResponse = {
  repository: {
    pullRequest: ReviewRequestPage | null;
  } | null;
};

const REVIEW_REQUEST_PAGE_SIZE = 100;
const TIMELINE_PAGE_SIZE = 200;
const MAX_RATE_LIMIT_WAIT_MS = 15 * 60 * 1000; // cap waits at 15 minutes per attempt

function parseArgs() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let since: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
      }
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
        index += 1;
      }
    }
    if (arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length).trim();
      if (value.length) {
        since = value;
      }
      continue;
    }
    if (arg === "--since") {
      const value = (args[index + 1] ?? "").trim();
      if (value.length) {
        since = value;
        index += 1;
      }
    }
  }

  if (since) {
    const parsed = Date.parse(since);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid --since value: ${since}`);
    }
  }

  return { limit, since };
}

async function fetchPullRequests(
  limit: number | null,
  since: string | null,
): Promise<PullRequestRef[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  let paramIndex = 1;
  if (since) {
    clauses.push(`pr.github_created_at >= $${paramIndex}::timestamptz`);
    params.push(since);
    paramIndex += 1;
  }

  const limitClause = limit ? `LIMIT $${paramIndex}` : "";
  if (limit) {
    params.push(limit);
  }

  const sql = `
    SELECT
      pr.id,
      pr.number,
      repo.name_with_owner AS name_with_owner,
      split_part(repo.name_with_owner, '/', 1) AS owner,
      split_part(repo.name_with_owner, '/', 2) AS name
    FROM pull_requests pr
    JOIN repositories repo ON repo.id = pr.repository_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY pr.inserted_at DESC
    ${limit ? limitClause : ""}
  `;

  const result = await query<{
    id: string;
    number: number;
    name_with_owner: string | null;
    owner: string | null;
    name: string | null;
  }>(sql, params);

  return result.rows
    .filter((row) => row.id && row.number && row.owner && row.name)
    .map((row) => ({
      id: row.id,
      number: row.number,
      owner: row.owner as string,
      name: row.name as string,
      nameWithOwner: row.name_with_owner as string,
    }));
}

async function fetchReviewRequestsWithEvents(
  client: ReturnType<typeof createGithubClient>,
  pr: PullRequestRef,
): Promise<{
  requests: Array<
    ReviewRequestNode & {
      createdAt: string | null;
    }
  >;
  eventMap: Map<string, string>;
}> {
  const queryDocument = `
    query PullRequestReviewRequests($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewRequests(first: ${REVIEW_REQUEST_PAGE_SIZE}) {
            nodes {
              id
              requestedReviewer {
                __typename
                ... on User { id }
                ... on Team { id }
              }
            }
          }
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: ${TIMELINE_PAGE_SIZE}, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              __typename
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  __typename
                  ... on User { id }
                  ... on Team { id }
                }
              }
            }
          }
        }
      }
    }
  `;

  const reviewRequestNodes: ReviewRequestNode[] = [];
  const events: ReviewRequestedEventNode[] = [];
  let cursor: string | null = null;
  let reviewRequestsFetched = false;

  for (;;) {
    const response = await requestWithRateLimitRetry<ReviewRequestPageResponse>(
      () =>
        client.request(queryDocument, {
          owner: pr.owner,
          name: pr.name,
          number: pr.number,
          cursor,
        }),
    );

    const pullRequest = response.repository?.pullRequest;
    if (!pullRequest) {
      break;
    }

    if (!reviewRequestsFetched) {
      const nodes = pullRequest.reviewRequests?.nodes;
      if (Array.isArray(nodes)) {
        reviewRequestNodes.push(
          ...nodes.filter((node): node is ReviewRequestNode =>
            Boolean(node?.id),
          ),
        );
      }
      reviewRequestsFetched = true;
    }

    if (Array.isArray(pullRequest.timelineItems?.nodes)) {
      for (const node of pullRequest.timelineItems.nodes) {
        if (node?.__typename === "ReviewRequestedEvent") {
          events.push(node);
        }
      }
    }

    const pageInfo = pullRequest.timelineItems?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      break;
    }
    cursor = pageInfo.endCursor;
  }

  const latestEventByReviewer = new Map<string, string>(); // reviewerId -> createdAt
  for (const event of events) {
    const reviewer = event.requestedReviewer;
    if (!reviewer || reviewer.__typename !== "User") {
      continue;
    }
    const existing = latestEventByReviewer.get(reviewer.id);
    if (!existing || existing < event.createdAt) {
      latestEventByReviewer.set(reviewer.id, event.createdAt);
    }
  }

  const withTimestamps: Array<
    ReviewRequestNode & { createdAt: string | null }
  > = [];

  for (const node of reviewRequestNodes) {
    const reviewer = node.requestedReviewer;
    if (!reviewer || reviewer.__typename !== "User") {
      continue;
    }
    const createdAt = latestEventByReviewer.get(reviewer.id) ?? null;
    if (!createdAt) {
      console.warn("[backfill] missing ReviewRequestedEvent for reviewer", {
        pr: pr.nameWithOwner,
        number: pr.number,
        reviewerId: reviewer.id,
      });
    }
    withTimestamps.push({
      ...node,
      createdAt,
    });
  }

  return { requests: withTimestamps, eventMap: latestEventByReviewer };
}

function getRateLimitDelayMs(error: ClientError): number | null {
  // GraphQL rate-limit errors typically set code: "RATE_LIMITED"
  const hasRateLimitCode = Boolean(
    error.response?.errors?.some(
      (err) =>
        err?.extensions &&
        typeof err.extensions === "object" &&
        (err.extensions as { code?: string }).code === "RATE_LIMITED",
    ),
  );

  const headers = error.response?.headers;
  const remainingHeader =
    headers && typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (key: string) => string | null }).get(
          "x-ratelimit-remaining",
        )
      : null;

  const resetHeader =
    headers && typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (key: string) => string | null }).get(
          "x-ratelimit-reset",
        )
      : null;

  const remainingZero = remainingHeader === "0";
  if (!hasRateLimitCode && !remainingZero) {
    return null;
  }

  const resetSeconds = resetHeader ? Number.parseInt(resetHeader, 10) : NaN;
  const now = Date.now();
  const resetMs = Number.isFinite(resetSeconds) ? resetSeconds * 1000 : now;
  const delay = Math.max(resetMs - now, 5_000); // wait at least 5s
  return Math.min(delay, MAX_RATE_LIMIT_WAIT_MS);
}

async function requestWithRateLimitRetry<T>(
  fn: () => Promise<T>,
  attempt = 1,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof ClientError)) {
      throw error;
    }

    const delay = getRateLimitDelayMs(error);
    if (delay === null) {
      throw error;
    }

    console.warn("[backfill] rate limited, sleeping", {
      attempt,
      delayMs: delay,
      resetAt: new Date(Date.now() + delay).toISOString(),
    });
    await sleep(delay);
    return requestWithRateLimitRetry(fn, attempt + 1);
  }
}

async function backfill() {
  const { limit, since } = parseArgs();
  await ensureSchema();

  console.info("[backfill] fetching pull requests", {
    limit: limit ?? "all",
    since: since ?? "all",
  });
  const pullRequests = await fetchPullRequests(limit, since);
  console.info("[backfill] found pull requests", {
    count: pullRequests.length,
  });

  if (!pullRequests.length) {
    return;
  }

  const client = createGithubClient();
  let processed = 0;
  let updated = 0;
  let prWithRequests = 0;
  let missingEvents = 0;

  for (const pr of pullRequests) {
    processed += 1;
    if (processed % 50 === 0 || processed === pullRequests.length) {
      console.info("[backfill] progress", {
        processed,
        total: pullRequests.length,
        updated,
      });
    }

    try {
      const { requests: reviewRequests, eventMap } =
        await fetchReviewRequestsWithEvents(client, pr);
      console.info("[backfill] fetched review requests", {
        pr: pr.nameWithOwner,
        number: pr.number,
        count: reviewRequests.length,
      });

      const existingRequests = await query<{
        id: string;
        reviewer_id: string | null;
      }>(
        `SELECT id, reviewer_id
         FROM review_requests
         WHERE pull_request_id = $1`,
        [pr.id],
      );

      const requestsToApply =
        reviewRequests.length > 0
          ? reviewRequests
          : existingRequests.rows
              .filter((row) => row.reviewer_id)
              .map((row) => ({
                id: row.id,
                requestedReviewer: {
                  __typename: "User" as const,
                  id: row.reviewer_id as string,
                },
                createdAt: eventMap.get(row.reviewer_id as string) ?? null,
              }));

      if (!requestsToApply.length) {
        continue;
      }

      prWithRequests += 1;
      for (const entry of requestsToApply) {
        if (!entry.createdAt) {
          missingEvents += 1;
          continue;
        }

        const reviewerId =
          entry.requestedReviewer &&
          entry.requestedReviewer.__typename === "User"
            ? entry.requestedReviewer.id
            : null;

        const existing = await query<{
          requested_at: string | null;
          reviewer_id: string | null;
        }>(
          `SELECT requested_at, reviewer_id FROM review_requests WHERE id = $1`,
          [entry.id],
        );
        const previousRequestedAt = existing.rows[0]?.requested_at ?? null;
        const previousReviewerId = existing.rows[0]?.reviewer_id ?? null;

        await upsertReviewRequest({
          id: entry.id,
          pullRequestId: pr.id,
          reviewerId,
          requestedAt: entry.createdAt,
          raw: entry,
        });
        updated += 1;

        if (
          previousRequestedAt !== entry.createdAt ||
          previousReviewerId !== reviewerId
        ) {
          console.info("[backfill] updated review request", {
            pr: pr.nameWithOwner,
            number: pr.number,
            reviewRequestId: entry.id,
            reviewerId,
            previousRequestedAt,
            requestedAt: entry.createdAt,
          });
        }
      }
    } catch (error) {
      console.error("[backfill] failed for pull request", {
        pr: pr.nameWithOwner,
        number: pr.number,
        error,
      });
    }
  }

  console.info("[backfill] complete", {
    processed,
    updated,
    prWithRequests,
    missingEvents,
    total: pullRequests.length,
  });
}

backfill()
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch((closeError) => {
      console.error("[backfill] failed to close pool", closeError);
    });
  });
