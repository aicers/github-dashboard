import {
  recordSyncLog,
  updateSyncLog,
  updateSyncState,
} from "@/lib/db/operations";
import { createGithubClient } from "@/lib/github/client";

import {
  collectDiscussionsForRepository,
  collectIssuesForRepository,
  reimportDiscussionNodeData,
  reimportIssueNodeData,
} from "./collectors/issues";
import {
  collectPullRequestLinksForRepository,
  collectPullRequestsForRepository,
  refreshOpenItemMetadata,
  reimportPullRequestNodeData,
} from "./collectors/pull-requests";
import {
  collectRepositories,
  ensureRepositoryRecord,
} from "./collectors/repositories";
import {
  type ActivityNodeResyncResponse,
  isDiscussionResyncNode,
  isIssueResyncNode,
  isPullRequestResyncNode,
  type SyncOptions,
} from "./collectors/types";
import {
  ensureLogId,
  maxTimestamp,
  requestWithRetry,
  wrapGithubError,
} from "./collectors/utils";
import { activityNodeResyncQuery } from "./queries";

export * from "./collectors/issues";
export * from "./collectors/project-status";
export * from "./collectors/pull-requests";
export * from "./collectors/repositories";
export * from "./collectors/types";
export * from "./collectors/utils";

export async function runCollection(options: SyncOptions) {
  if (!options.org) {
    throw new Error("GitHub organization is not configured.");
  }

  const client = options.client ?? createGithubClient();
  const runId = options.runId ?? null;
  const repoLogId = ensureLogId(
    await recordSyncLog("repositories", "running", undefined, runId),
  );
  let repositories: Awaited<
    ReturnType<typeof collectRepositories>
  >["repositories"] = [];
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

export async function reimportActivityNode(options: {
  nodeId: string;
  logger?: SyncOptions["logger"];
  client?: SyncOptions["client"];
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
