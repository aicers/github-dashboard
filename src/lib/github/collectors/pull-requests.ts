import type { GraphQLClient } from "graphql-request";

import {
  deleteMissingCommentsForTarget,
  listExistingPullRequestIds,
  listPendingReviewRequestsByPullRequestIds,
  markReviewRequestRemoved,
  type PendingReviewRequest,
  replacePullRequestIssues,
  reviewExists,
  updateIssueAssignees,
  updatePullRequestAssignees,
  upsertComment,
  upsertPullRequest,
  upsertReview,
  upsertReviewRequest,
} from "@/lib/db/operations";
import {
  openIssueMetadataQuery,
  openPullRequestMetadataQuery,
  pullRequestMetadataByNumberQuery,
  pullRequestReviewCommentsQuery,
  pullRequestReviewsQuery,
  repositoryPullRequestLinksQuery,
  repositoryPullRequestsQuery,
} from "@/lib/github/queries";
import { collectIssueComments } from "./issues";
import type {
  GithubActor,
  IssueNode,
  IssueRelationNode,
  OpenIssueMetadataQueryResponse,
  OpenPullRequestMetadataQueryResponse,
  PullRequestLinkNode,
  PullRequestMetadataByNumberQueryResponse,
  PullRequestMetadataNode,
  PullRequestNode,
  PullRequestReviewCommentsQueryResponse,
  PullRequestReviewsQueryResponse,
  RepositoryNode,
  RepositoryPullRequestLinksQueryResponse,
  RepositoryPullRequestsQueryResponse,
  ReviewCollectionResult,
  ReviewNode,
  SyncOptions,
} from "./types";
import {
  buildAssigneesPayload,
  createBounds,
  describeError,
  evaluateTimestamp,
  formatBoundsForLog,
  maxTimestamp,
  processActor,
  processActorNodes,
  processReactions,
  requestWithRetry,
  resolveCommentReactionSubjectType,
  resolveSince,
  resolveUntil,
  reviewerIsUser,
  wrapGithubError,
} from "./utils";

type CommentCollectionResult = {
  latest: string | null;
  count: number;
  ids: string[];
};

async function syncReviewRequestsSnapshot(
  pullRequest: PullRequestMetadataNode,
  pendingRequests: PendingReviewRequest[] | undefined,
) {
  let added = 0;
  let removed = 0;
  const requests = pullRequest.reviewRequests?.nodes ?? [];
  const events = pullRequest.timelineItems?.nodes ?? [];
  const activeReviewerIds = new Set<string>();

  const latestEventByReviewer = new Map<string, string>(); // reviewerId -> createdAt
  for (const node of events) {
    if (!node || node.__typename !== "ReviewRequestedEvent") {
      continue;
    }
    const reviewer = node.requestedReviewer;
    if (!reviewerIsUser(reviewer)) {
      continue;
    }
    const existing = latestEventByReviewer.get(reviewer.id);
    if (!existing || existing < node.createdAt) {
      latestEventByReviewer.set(reviewer.id, node.createdAt);
    }
  }

  for (const entry of requests) {
    if (!entry) {
      continue;
    }
    const reviewer = entry.requestedReviewer;
    if (!reviewerIsUser(reviewer)) {
      continue;
    }
    const requestedAt = latestEventByReviewer.get(reviewer.id);
    if (!requestedAt) {
      console.warn("[open-items] missing ReviewRequestedEvent for reviewer", {
        pullRequestId: pullRequest.id,
        reviewerId: reviewer.id,
      });
      activeReviewerIds.add(reviewer.id);
      continue;
    }
    await processActor(reviewer);
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

export async function collectReviewComments(
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
  const collectedIds = new Set<string>();
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
      for (const comment of (thread.comments?.nodes ?? []) as ReviewNode[]) {
        const c = comment as unknown as {
          id: string;
          __typename?: string | null;
          author?: GithubActor | null;
          createdAt: string;
          updatedAt?: string | null;
          pullRequestReview?: { id: string } | null;
          reactions?: { nodes: unknown[] | null } | null;
        };
        const timestamp = c.updatedAt ?? c.createdAt;
        const decision = evaluateTimestamp(timestamp, bounds);
        if (!decision.include) {
          if (decision.afterUpperBound) {
            reachedUpperBound = true;
            break;
          }
          continue;
        }

        const authorId = await processActor(c.author);
        let reviewId: string | null = null;
        const potentialReviewId = c.pullRequestReview?.id ?? null;
        if (potentialReviewId) {
          if (reviewCache.has(potentialReviewId)) {
            reviewId = potentialReviewId;
          } else if (await reviewExists(potentialReviewId)) {
            reviewCache.add(potentialReviewId);
            reviewId = potentialReviewId;
          } else {
            logger?.(
              `Review ${potentialReviewId} referenced by comment ${c.id} was not found. Saving without review reference.`,
            );
          }
        }

        await upsertComment({
          id: c.id,
          issueId: null,
          pullRequestId: pullRequest.id,
          reviewId,
          authorId: authorId ?? null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt ?? null,
          raw: c,
        });

        const reactionSubjectType = resolveCommentReactionSubjectType(
          "pull_request",
          c as Parameters<typeof resolveCommentReactionSubjectType>[1],
        );
        await processReactions(
          c.reactions as Parameters<typeof processReactions>[0],
          reactionSubjectType,
          c.id,
        );

        collectedIds.add(c.id);
        latest = maxTimestamp(latest, timestamp);
        count += 1;
      }
      if (reachedUpperBound) {
        break;
      }
    }

    if (reachedUpperBound) {
      cursor = null;
      break;
    }

    hasNextPage = threads?.pageInfo?.hasNextPage ?? false;
    cursor = threads?.pageInfo?.endCursor ?? null;
  }

  await deleteMissingCommentsForTarget({
    pullRequestId: pullRequest.id,
    since: effectiveSince,
    until: effectiveUntil,
    keepIds: Array.from(collectedIds),
    scope: "review_only",
  });

  return { latest, count, ids: Array.from(collectedIds) };
}

export async function collectReviews(
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
      cursor = null;
      break;
    }

    hasNextPage = reviewsConnection?.pageInfo?.hasNextPage ?? false;
    cursor = reviewsConnection?.pageInfo?.endCursor ?? null;
  }

  return { latest, count, reviewIds };
}

export async function collectPullRequestsForRepository(
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

async function retryMissingPullRequestsForReviewRequestSync(params: {
  client: GraphQLClient;
  repository: RepositoryNode;
  options: SyncOptions;
  missingPullRequestNumbers: Map<string, number>;
}) {
  const { client, repository, options, missingPullRequestNumbers } = params;
  const [owner, name] = repository.nameWithOwner.split("/");
  const { logger } = options;
  let reviewRequestsAdded = 0;
  let reviewRequestsRemoved = 0;

  for (const [
    expectedPullRequestId,
    pullRequestNumber,
  ] of missingPullRequestNumbers.entries()) {
    try {
      const data =
        await requestWithRetry<PullRequestMetadataByNumberQueryResponse>(
          client,
          pullRequestMetadataByNumberQuery,
          {
            owner,
            name,
            number: pullRequestNumber,
          },
          {
            logger,
            context: `pull request metadata ${repository.nameWithOwner}#${pullRequestNumber}`,
          },
        );

      const pullRequest = data.repository?.pullRequest;
      if (!pullRequest) {
        logger?.(
          `[open-items] Could not retry review request sync for ${repository.nameWithOwner}#${pullRequestNumber}: pull request not found.`,
        );
        continue;
      }

      if (pullRequest.id !== expectedPullRequestId) {
        logger?.(
          `[open-items] Skipping retry for ${repository.nameWithOwner}#${pullRequestNumber}: expected ${expectedPullRequestId}, got ${pullRequest.id}.`,
        );
        continue;
      }

      const authorId = await processActor(pullRequest.author);
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
      await updatePullRequestAssignees(
        pullRequest.id,
        buildAssigneesPayload(pullRequest.assignees ?? null),
      );

      const pendingRequests = await listPendingReviewRequestsByPullRequestIds([
        pullRequest.id,
      ]);
      const reviewCounts = await syncReviewRequestsSnapshot(
        pullRequest,
        pendingRequests.get(pullRequest.id),
      );
      reviewRequestsAdded += reviewCounts.added;
      reviewRequestsRemoved += reviewCounts.removed;
    } catch (error) {
      logger?.(
        `[open-items] Failed retrying review request sync for ${repository.nameWithOwner}#${pullRequestNumber}: ${describeError(error)}`,
      );
    }
  }

  return {
    reviewRequestsAdded,
    reviewRequestsRemoved,
  };
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
  const missingPullRequestNumbers = new Map<string, number>();

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
    const existingPullRequestIds = nodes.length
      ? await listExistingPullRequestIds(nodes.map((node) => node.id))
      : new Set<string>();
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
      if (!existingPullRequestIds.has(pullRequest.id)) {
        missingPullRequestNumbers.set(pullRequest.id, pullRequest.number);
        pullRequestCount += 1;
        continue;
      }
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

  if (missingPullRequestNumbers.size) {
    const retryResult = await retryMissingPullRequestsForReviewRequestSync({
      client,
      repository,
      options,
      missingPullRequestNumbers,
    });
    reviewRequestsAdded += retryResult.reviewRequestsAdded;
    reviewRequestsRemoved += retryResult.reviewRequestsRemoved;
  }

  return {
    pullRequests: pullRequestCount,
    reviewRequestsAdded,
    reviewRequestsRemoved,
  };
}

export async function refreshOpenItemMetadata(
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

export async function collectPullRequestLinksForRepository(
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

export async function reimportPullRequestNodeData(params: {
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

// Re-export IssueNode for use in the orchestrator (reimportPullRequestNodeData
// references IssueNode via PullRequestNode which extends IssueNode)
export type { IssueNode };
