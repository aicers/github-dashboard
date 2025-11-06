import { type GraphQLClient, gql } from "graphql-request";

import { normalizeProjectTarget } from "@/lib/activity/base-query";
import {
  fetchStuckReviewRequests,
  fetchUnansweredMentionCandidates,
  type MentionDatasetItem,
  normalizeOrganizationHolidayCodes,
  type ReviewRequestRawItem,
} from "@/lib/dashboard/attention";
import { loadCombinedHolidaySet } from "@/lib/dashboard/business-days";
import { ensureSchema } from "@/lib/db";
import {
  getSyncConfig,
  listCommentIdsByPullRequestIds,
  listReviewIdsByPullRequestIds,
  upsertReaction,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import { createGithubClient } from "@/lib/github/client";
import type { SyncLogger } from "@/lib/github/collectors";

type ReactionRefreshOptions = {
  logger?: SyncLogger;
  now?: Date;
};

type NodeReactionsQuery = {
  node?:
    | null
    | ({
        __typename?: string | null;
        reactions?: null | {
          pageInfo?: {
            hasNextPage: boolean;
            endCursor?: string | null;
          } | null;
          nodes?: Array<null | {
            id: string;
            content?: string | null;
            createdAt?: string | null;
            user?: null | {
              id?: string | null;
            };
          }> | null;
        };
      } & { id?: string | null });
};

const NODE_REACTIONS_QUERY = gql`
  query NodeReactions($id: ID!, $cursor: String) {
    node(id: $id) {
      __typename
      ... on Reactable {
        id
        reactions(
          first: 100
          after: $cursor
          orderBy: { field: CREATED_AT, direction: ASC }
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            content
            createdAt
            user {
              id
            }
          }
        }
      }
    }
  }
`;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveSubjectType(
  typename: string | null | undefined,
): string | null {
  if (!typename) {
    return null;
  }

  switch (typename) {
    case "Issue":
      return "issue";
    case "PullRequest":
      return "pullrequest";
    case "Discussion":
      return "discussion";
    case "PullRequestReview":
      return "pullrequestreview";
    case "IssueComment":
    case "PullRequestReviewComment":
    case "CommitComment":
    case "DiscussionComment":
    case "TeamDiscussionComment":
      return typename.toLowerCase();
    default:
      return typename.trim().length > 0 ? typename.trim().toLowerCase() : null;
  }
}

async function collectNodeReactions(
  client: GraphQLClient,
  nodeId: string,
  logger?: SyncLogger,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  let subjectType: string | null = null;
  let typename: string | null = null;

  while (true) {
    let data: NodeReactionsQuery;
    try {
      data = await client.request<NodeReactionsQuery>(NODE_REACTIONS_QUERY, {
        id: nodeId,
        cursor,
      });
    } catch (error) {
      logger?.(
        `[reaction-refresh] Failed to fetch reactions for node ${nodeId}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      break;
    }

    const node = data.node;
    if (!node || !("reactions" in node) || !node.reactions) {
      if (!typename) {
        logger?.(
          `[reaction-refresh] Node ${nodeId} does not implement Reactable or was not found`,
        );
      }
      break;
    }

    typename = node.__typename ?? typename;
    if (!subjectType && node.__typename) {
      subjectType = resolveSubjectType(node.__typename);
      if (!subjectType) {
        logger?.(
          `[reaction-refresh] Unable to resolve subject type for ${node.__typename} (${nodeId})`,
        );
        break;
      }
    }

    const reactions = node.reactions.nodes ?? [];
    for (const reaction of reactions) {
      if (!reaction) {
        continue;
      }

      await upsertReaction({
        id: reaction.id,
        subjectType: subjectType ?? "unknown",
        subjectId: nodeId,
        userId: reaction.user?.id ?? null,
        content: reaction.content ?? null,
        createdAt: reaction.createdAt ?? null,
        raw: reaction,
      });

      total += 1;
    }

    const pageInfo = node.reactions.pageInfo;
    if (pageInfo?.hasNextPage && pageInfo.endCursor) {
      cursor = pageInfo.endCursor;
    } else {
      break;
    }
  }

  return total;
}

function extractMentionCommentIds(mentions: MentionDatasetItem[]): Set<string> {
  const ids = new Set<string>();
  mentions.forEach((mention) => {
    if (mention.commentId) {
      ids.add(mention.commentId);
    }
  });
  return ids;
}

function extractPullRequestIds(requests: ReviewRequestRawItem[]): Set<string> {
  const ids = new Set<string>();
  requests.forEach((item) => {
    const pullRequestId = item.pullRequest.id;
    if (pullRequestId) {
      ids.add(pullRequestId);
    }
  });
  return ids;
}

export async function refreshAttentionReactions(
  options?: ReactionRefreshOptions,
): Promise<void> {
  const logger = options?.logger;
  const now = options?.now ?? new Date();

  await ensureSchema();

  const config = await getSyncConfig();
  const organizationHolidayCodes =
    normalizeOrganizationHolidayCodes(config) ?? [];
  const organizationHolidaySet = await loadCombinedHolidaySet(
    organizationHolidayCodes,
  );

  const excludedRepositoryIds = normalizeStringArray(
    config?.excluded_repository_ids ?? [],
  );
  const excludedUserIds = normalizeStringArray(config?.excluded_user_ids ?? []);

  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);

  const [mentionCandidates, reviewRequestDataset] = await Promise.all([
    fetchUnansweredMentionCandidates(
      excludedRepositoryIds,
      excludedUserIds,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
      targetProject,
    ),
    fetchStuckReviewRequests(
      excludedRepositoryIds,
      excludedUserIds,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
  ]);

  const mentionCommentIds = extractMentionCommentIds(mentionCandidates);
  const reviewRequests = reviewRequestDataset.items;
  const pullRequestIds = extractPullRequestIds(reviewRequests);

  if (!mentionCommentIds.size && !pullRequestIds.size) {
    logger?.(
      "[reaction-refresh] No unanswered mentions or review requests require reaction refresh",
    );
    return;
  }

  const [commentMap, reviewMap] = await Promise.all([
    listCommentIdsByPullRequestIds(Array.from(pullRequestIds)),
    listReviewIdsByPullRequestIds(Array.from(pullRequestIds)),
  ]);

  const nodeIds = new Set<string>();
  for (const id of mentionCommentIds) {
    nodeIds.add(id);
  }
  for (const id of pullRequestIds) {
    nodeIds.add(id);
  }

  commentMap.forEach((ids) => {
    for (const id of ids) {
      nodeIds.add(id);
    }
  });
  reviewMap.forEach((ids) => {
    for (const id of ids) {
      nodeIds.add(id);
    }
  });

  if (!nodeIds.size) {
    logger?.(
      "[reaction-refresh] No GraphQL nodes identified for reaction refresh",
    );
    return;
  }

  logger?.(
    `[reaction-refresh] Refreshing reactions for ${nodeIds.size} node(s) (mentions=${mentionCommentIds.size}, pullRequests=${pullRequestIds.size})`,
  );

  const client = createGithubClient();
  let totalReactions = 0;
  for (const nodeId of nodeIds) {
    const count = await collectNodeReactions(client, nodeId, logger);
    totalReactions += count;
  }

  logger?.(
    `[reaction-refresh] Completed reaction refresh for ${nodeIds.size} node(s); upserted ${totalReactions} reaction(s)`,
  );
}
