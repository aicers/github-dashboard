import type { GraphQLClient } from "graphql-request";

import { clearProjectFieldOverrides } from "@/lib/activity/project-field-store";
import { clearActivityStatuses } from "@/lib/activity/status-store";
import {
  deleteMissingCommentsForTarget,
  fetchIssueRawMap,
  upsertComment,
  upsertIssue,
} from "@/lib/db/operations";
import {
  discussionCommentRepliesQuery,
  discussionCommentsQuery,
  issueCommentsQuery,
  pullRequestCommentsQuery,
  repositoryDiscussionsQuery,
  repositoryIssuesQuery,
} from "@/lib/github/queries";
import {
  collectProjectStatusSnapshots,
  createRemovalEntries,
  extractProjectStatusHistoryFromRaw,
  isTargetProject,
  mergeProjectStatusHistory,
  TARGET_TODO_PROJECT,
} from "./project-status";
import type {
  CommentCollectionResult,
  CommentNode,
  CommentTarget,
  DiscussionCollectionResult,
  DiscussionCommentRepliesQueryResponse,
  DiscussionCommentsQueryResponse,
  DiscussionNode,
  IssueCommentsQueryResponse,
  IssueNode,
  PageInfo,
  PullRequestCommentsQueryResponse,
  RepositoryDiscussionsQueryResponse,
  RepositoryIssuesQueryResponse,
  RepositoryNode,
  SyncOptions,
} from "./types";
import {
  createBounds,
  evaluateTimestamp,
  isNotFoundError,
  maxTimestamp,
  processActor,
  processActorNodes,
  processReactions,
  requestWithRetry,
  resolveCommentReactionSubjectType,
  resolveSince,
  resolveUntil,
  wrapGithubError,
} from "./utils";

export async function collectIssueComments(
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
    return { latest: null, count: 0, ids: [] };
  }

  let cursor: string | null = null;
  let hasNextPage = true;
  let latest: string | null = null;
  let count = 0;
  const processedCommentIds = new Set<string>();
  const collectedIds = new Set<string>();
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
    let commentNodes =
      extraDiscussionComments.length > 0
        ? [...baseNodes, ...extraDiscussionComments]
        : baseNodes;

    if (target === "discussion" && commentNodes.length) {
      commentNodes = await expandDiscussionCommentTree(
        client,
        repository,
        issue.number ?? null,
        commentNodes,
        options,
      );
    }
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

      collectedIds.add(comment.id);
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

  const deletionScope =
    target === "pull_request" ? ("non_review" as const) : ("any" as const);
  await deleteMissingCommentsForTarget({
    issueId: target === "pull_request" ? null : issue.id,
    pullRequestId: target === "pull_request" ? issue.id : null,
    since: effectiveSince,
    until: effectiveUntil,
    keepIds: Array.from(collectedIds),
    scope: deletionScope,
  });

  return { latest, count, ids: Array.from(collectedIds) };
}

function hasDiscussionReplies(comment: CommentNode | null | undefined) {
  if (!comment?.replies) {
    return false;
  }
  const nodes = Array.isArray(comment.replies.nodes)
    ? comment.replies.nodes.filter((node): node is CommentNode => Boolean(node))
    : [];
  if (nodes.length) {
    return true;
  }
  return Boolean(comment.replies.pageInfo?.hasNextPage);
}

async function expandDiscussionCommentTree(
  client: GraphQLClient,
  repository: RepositoryNode,
  discussionNumber: number | null,
  comments: CommentNode[],
  options: SyncOptions,
) {
  const expanded: CommentNode[] = [];
  for (const comment of comments) {
    expanded.push(comment);
    const replies = await collectDiscussionCommentRepliesRecursive(
      client,
      repository,
      discussionNumber,
      comment,
      options,
    );
    if (replies.length) {
      expanded.push(...replies);
    }
  }
  return expanded;
}

async function collectDiscussionCommentRepliesRecursive(
  client: GraphQLClient,
  repository: RepositoryNode,
  discussionNumber: number | null,
  comment: CommentNode,
  options: SyncOptions,
): Promise<CommentNode[]> {
  if (!hasDiscussionReplies(comment)) {
    return [];
  }

  const immediateReplies = await gatherDiscussionCommentReplies(
    client,
    repository,
    discussionNumber,
    comment,
    options,
  );
  if (!immediateReplies.length) {
    return [];
  }

  const flattened: CommentNode[] = [...immediateReplies];
  for (const reply of immediateReplies) {
    const nested = await collectDiscussionCommentRepliesRecursive(
      client,
      repository,
      discussionNumber,
      reply,
      options,
    );
    if (nested.length) {
      flattened.push(...nested);
    }
  }

  return flattened;
}

async function gatherDiscussionCommentReplies(
  client: GraphQLClient,
  repository: RepositoryNode,
  discussionNumber: number | null,
  comment: CommentNode,
  options: SyncOptions,
): Promise<CommentNode[]> {
  const replies: CommentNode[] = [];
  const initialNodes = Array.isArray(comment.replies?.nodes)
    ? (comment.replies?.nodes ?? []).filter((node): node is CommentNode =>
        Boolean(node),
      )
    : [];
  if (initialNodes.length) {
    replies.push(...initialNodes);
  }

  if (!comment.id) {
    return replies;
  }

  let cursor = comment.replies?.pageInfo?.endCursor ?? null;
  let hasNextPage = comment.replies?.pageInfo?.hasNextPage ?? false;
  while (hasNextPage) {
    const connection = await fetchDiscussionCommentRepliesConnection(
      client,
      comment.id,
      cursor,
      repository,
      discussionNumber,
      options,
    );
    if (!connection) {
      break;
    }
    const nodes = Array.isArray(connection.nodes)
      ? (connection.nodes ?? []).filter((node): node is CommentNode =>
          Boolean(node),
        )
      : [];
    if (nodes.length) {
      replies.push(...nodes);
    }
    hasNextPage = connection.pageInfo?.hasNextPage ?? false;
    cursor = connection.pageInfo?.endCursor ?? null;
  }

  return replies;
}

async function fetchDiscussionCommentRepliesConnection(
  client: GraphQLClient,
  commentId: string,
  cursor: string | null,
  repository: RepositoryNode,
  discussionNumber: number | null,
  options: SyncOptions,
) {
  const data: DiscussionCommentRepliesQueryResponse = await requestWithRetry(
    client,
    discussionCommentRepliesQuery,
    {
      id: commentId,
      cursor,
    },
    {
      logger: options.logger,
      context: `discussion comment replies ${repository.nameWithOwner}#${discussionNumber ?? "unknown"}`,
    },
  );
  const node = data.node;
  if (!node || node.__typename !== "DiscussionComment") {
    return null;
  }
  return node.replies ?? null;
}

export async function collectDiscussionsForRepository(
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

export async function collectIssuesForRepository(
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

export async function reimportIssueNodeData(params: {
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

export async function reimportDiscussionNodeData(params: {
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
