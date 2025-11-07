import { ClientError, type GraphQLClient, gql } from "graphql-request";

import { refreshActivityCaches } from "@/lib/activity/cache";
import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { query, withTransaction } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import { createGithubClient } from "@/lib/github/client";
import type { SyncLogger } from "@/lib/github/collectors";

type IssueCandidateRow = {
  id: string;
  repository_id: string | null;
  stored_repo: string | null;
  url: string | null;
  ownership_checked_at: string | null;
  project_item_ids: string[] | null;
  ui_mismatch: boolean;
};

type GraphNodeOwner = {
  __typename?: string | null;
  id?: string | null;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type GraphRepositoryNode = {
  id?: string | null;
  name?: string | null;
  nameWithOwner?: string | null;
  url?: string | null;
  isPrivate?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  owner?: GraphNodeOwner | null;
};

type GraphIssueNode = {
  __typename: "Issue";
  id: string;
  number: number;
  title?: string | null;
  state?: string | null;
  url?: string | null;
  body?: string | null;
  bodyText?: string | null;
  bodyHTML?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  author?: GraphNodeOwner | null;
  repository?: GraphRepositoryNode | null;
};

type GraphDiscussionNode = {
  __typename: "Discussion";
  id: string;
  number: number;
  title?: string | null;
  body?: string | null;
  bodyText?: string | null;
  bodyHTML?: string | null;
  url?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  answerChosenAt?: string | null;
  author?: GraphNodeOwner | null;
  repository?: GraphRepositoryNode | null;
};

type GraphNodeEntry = GraphIssueNode | GraphDiscussionNode | null;

type RateLimitInfo = {
  cost?: number | null;
  remaining?: number | null;
  resetAt?: string | null;
};

type NodeRepositoryResponse = {
  nodes?: Array<GraphNodeEntry | null>;
  rateLimit?: RateLimitInfo | null;
};

const NODE_DETAILS_QUERY = gql`
  query NodeRepositoryRefresh($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Issue {
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
          ... on Mannequin {
            id
            login
            name
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
        assignees(first: 25) {
          nodes {
            __typename
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
          last: 25
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
        repository {
          id
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
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
          }
        }
      }
      ... on Discussion {
        id
        number
        title
        body
        bodyText
        bodyHTML
        url
        createdAt
        updatedAt
        closedAt
        answerChosenAt
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
          ... on Mannequin {
            id
            login
            name
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
          ... on Mannequin {
            id
            login
            name
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
        repository {
          id
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
              login
              name
              avatarUrl(size: 200)
              createdAt
              updatedAt
            }
          }
        }
      }
    }
    rateLimit {
      cost
      remaining
      resetAt
    }
  }
`;

const RESOURCE_LOOKUP_QUERY = gql`
  query NodeByUrl($url: URI!) {
    resource(url: $url) {
      __typename
      ... on Issue {
        id
      }
    }
  }
`;

export type RepositoryRealignmentSummary = {
  candidates: number;
  updated: number;
  dryRun: boolean;
};

export type RepositoryRealignmentOptions = {
  client?: GraphQLClient;
  limit?: number;
  chunkSize?: number;
  dryRun?: boolean;
  refreshArtifacts?: boolean;
  logger?: SyncLogger;
  waitForRateLimit?: boolean;
  waitTimeoutMs?: number;
  mode?: "automatic" | "manual";
  ids?: string[];
};

const DEFAULT_LIMIT = 500;
const DEFAULT_CHUNK_SIZE = 25;
const RATE_LIMIT_MIN_REMAINING = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const OWNERSHIP_RECHECK_INTERVAL_DAYS = 7;
const GITHUB_ORG_DISCUSSIONS_PREFIX = "https://github.com/orgs/";
const MAX_REDIRECT_HOPS = 5;

const UI_MISMATCH_SQL = `
        r.name_with_owner IS NOT NULL
        AND COALESCE(i.data->>'url', '') <> ''
        AND (i.data->>'url') ILIKE 'https://github.com/%'
        AND NOT (i.data->>'url') ILIKE CONCAT('https://github.com/', r.name_with_owner, '/%')
        AND NOT (i.data->>'url') ILIKE '${GITHUB_ORG_DISCUSSIONS_PREFIX}%'
      `;

const OWNERSHIP_STALE_SQL = `
        i.ownership_checked_at IS NULL
        OR i.ownership_checked_at < NOW() - INTERVAL '${OWNERSHIP_RECHECK_INTERVAL_DAYS} days'
      `;

function isIssueNode(node: GraphNodeEntry): node is GraphIssueNode {
  return Boolean(node && node.__typename === "Issue");
}

function isDiscussionNode(node: GraphNodeEntry): node is GraphDiscussionNode {
  return Boolean(node && node.__typename === "Discussion");
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function resolveRedirectUrl(
  url: string,
  logger?: SyncLogger,
): Promise<string | null> {
  if (typeof fetch !== "function") {
    return null;
  }

  let current = url;
  for (let attempt = 0; attempt < MAX_REDIRECT_HOPS; attempt += 1) {
    try {
      const response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: {
          accept: "text/html",
        },
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        const location = response.headers.get("location") ?? "";
        const nextUrl = new URL(location, current).toString();
        current = nextUrl;
        continue;
      }

      if (response.ok) {
        return current;
      }

      return null;
    } catch (error) {
      logger?.(
        `[realign] Failed to resolve redirect for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  return current !== url ? current : null;
}

async function lookupNodeIdByUrl(
  client: GraphQLClient,
  url: string,
): Promise<string | null> {
  const response = await client.request<{
    resource: { __typename?: string | null; id?: string | null } | null;
  }>(RESOURCE_LOOKUP_QUERY, {
    url,
  });
  const resource = response.resource;
  if (
    resource &&
    typeof resource.id === "string" &&
    (resource.__typename === "Issue" || resource.__typename === "Discussion")
  ) {
    return resource.id;
  }
  return null;
}

async function fetchNodeById(
  client: GraphQLClient,
  id: string,
): Promise<GraphNodeEntry | null> {
  const { nodes } = await fetchNodeDetails(client, [id]);
  return nodes.get(id) ?? null;
}

async function resolveNodeFromUrl(params: {
  client: GraphQLClient;
  url: string | null;
  logger?: SyncLogger;
}): Promise<{ node: GraphNodeEntry; resolvedUrl: string | null } | null> {
  const { client, url, logger } = params;
  if (!url) {
    return null;
  }

  const attemptUrls = new Set<string>();
  attemptUrls.add(url);

  const redirectUrl = await resolveRedirectUrl(url, logger);
  if (redirectUrl && redirectUrl !== url) {
    attemptUrls.add(redirectUrl);
  }

  for (const candidateUrl of attemptUrls) {
    const nodeId = await lookupNodeIdByUrl(client, candidateUrl);
    if (!nodeId) {
      continue;
    }
    const node = await fetchNodeById(client, nodeId);
    if (node) {
      return { node, resolvedUrl: candidateUrl };
    }
  }

  return null;
}

async function fetchOwnershipCheckCandidates(limit: number, ids?: string[]) {
  if (Array.isArray(ids) && ids.length > 0) {
    const uniqueIds = Array.from(
      new Set(ids.filter((value) => typeof value === "string" && value)),
    );
    if (!uniqueIds.length) {
      return [];
    }
    const targeted = await query<IssueCandidateRow>(
      `
        SELECT
          i.id,
          i.repository_id,
          r.name_with_owner AS stored_repo,
          i.data->>'url' AS url,
          i.ownership_checked_at,
          ARRAY(
            SELECT project_node->>'id'
            FROM jsonb_array_elements(
              COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)
            ) AS project_node
            WHERE project_node->>'id' IS NOT NULL
          ) AS project_item_ids,
          (
${UI_MISMATCH_SQL}
          ) AS ui_mismatch
        FROM issues i
        LEFT JOIN repositories r ON r.id = i.repository_id
        WHERE i.id = ANY($1::text[])
        LIMIT $2
      `,
      [uniqueIds, limit],
    );
    return targeted.rows;
  }

  const result = await query<IssueCandidateRow>(
    `
      SELECT
        i.id,
        i.repository_id,
        r.name_with_owner AS stored_repo,
        i.data->>'url' AS url,
        i.ownership_checked_at,
        ARRAY(
          SELECT project_node->>'id'
          FROM jsonb_array_elements(
            COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)
          ) AS project_node
          WHERE project_node->>'id' IS NOT NULL
        ) AS project_item_ids,
        (
${UI_MISMATCH_SQL}
        ) AS ui_mismatch
      FROM issues i
      LEFT JOIN repositories r ON r.id = i.repository_id
      WHERE
        (
${UI_MISMATCH_SQL}
        )
        OR (
${OWNERSHIP_STALE_SQL}
        )
      ORDER BY
        CASE
          WHEN
${UI_MISMATCH_SQL}
          THEN 0
          ELSE 1
        END,
        i.ownership_checked_at NULLS FIRST,
        i.github_updated_at DESC NULLS LAST
      LIMIT $1
    `,
    [limit],
  );

  return result.rows;
}

async function markOwnershipChecked(ids: Iterable<string>) {
  const uniqueIds = Array.from(new Set(ids)).filter((id) => Boolean(id));
  if (!uniqueIds.length) {
    return;
  }

  await query(
    `
      UPDATE issues
         SET ownership_checked_at = NOW()
       WHERE id = ANY($1::text[])
    `,
    [uniqueIds],
  );
}

async function findIssueIdByProjectItems(params: {
  excludeId?: string | null;
  projectItemIds?: string[] | null;
}): Promise<string | null> {
  const { excludeId, projectItemIds } = params;
  const ids =
    Array.isArray(projectItemIds) && projectItemIds.length
      ? Array.from(
          new Set(
            projectItemIds.filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            ),
          ),
        )
      : [];
  if (!ids.length) {
    return null;
  }

  const result = await query<{ id: string }>(
    `
      SELECT issue.id
        FROM issues AS issue
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(issue.data->'projectItems'->'nodes', '[]'::jsonb)
        ) AS project_node
       WHERE ($1::text IS NULL OR issue.id <> $1)
         AND project_node->>'id' = ANY($2::text[])
       ORDER BY issue.github_updated_at DESC NULLS LAST
       LIMIT 1
    `,
    [excludeId ?? null, ids],
  );

  return result.rows[0]?.id ?? null;
}

async function migrateIssueIdentity(params: {
  oldId: string;
  newId: string;
  logger?: SyncLogger;
}) {
  const { oldId, newId, logger } = params;
  if (!oldId || !newId || oldId === newId) {
    return;
  }

  await withTransaction(async (client) => {
    const referencingUpdates = [
      `UPDATE comments SET issue_id = $2 WHERE issue_id = $1`,
      `UPDATE activity_issue_status_history SET issue_id = $2 WHERE issue_id = $1`,
      `UPDATE activity_issue_project_overrides SET issue_id = $2 WHERE issue_id = $1`,
      `UPDATE pull_request_issues SET issue_id = $2 WHERE issue_id = $1`,
    ];
    for (const statement of referencingUpdates) {
      await client.query(statement, [oldId, newId]);
    }

    const cacheTables = [
      { table: "activity_items", column: "id" },
      { table: "activity_comment_participants", column: "item_id" },
      { table: "activity_comment_mentions", column: "item_id" },
      { table: "activity_reaction_users", column: "item_id" },
      { table: "activity_issue_links_cache", column: "issue_id" },
    ];
    for (const { table, column } of cacheTables) {
      await client.query(
        `DELETE FROM ${table}
          WHERE ${column} = $1`,
        [newId],
      );
      await client.query(
        `UPDATE ${table}
            SET ${column} = $2
          WHERE ${column} = $1`,
        [oldId, newId],
      );
    }

    const existingNew = await client.query<{ id: string }>(
      `SELECT id FROM issues WHERE id = $1`,
      [newId],
    );
    if ((existingNew.rowCount ?? 0) > 0) {
      await client.query(`DELETE FROM issues WHERE id = $1`, [oldId]);
    } else {
      await client.query(`UPDATE issues SET id = $2 WHERE id = $1`, [
        oldId,
        newId,
      ]);
    }
  });

  logger?.(`[realign] Migrated issue id ${oldId} -> ${newId}.`);
}

async function fetchNodeDetails(client: GraphQLClient, ids: string[]) {
  if (!ids.length) {
    return { nodes: new Map<string, GraphNodeEntry>(), rateLimit: null };
  }
  let response: NodeRepositoryResponse | null = null;
  try {
    response = await client.request<NodeRepositoryResponse>(
      NODE_DETAILS_QUERY,
      { ids },
    );
  } catch (error) {
    if (
      error instanceof ClientError &&
      error.response?.data &&
      typeof error.response.data === "object"
    ) {
      response = error.response.data as NodeRepositoryResponse;
    } else {
      throw error;
    }
  }

  const map = new Map<string, GraphNodeEntry>();
  for (const entry of response?.nodes ?? []) {
    if (
      entry &&
      typeof entry.id === "string" &&
      (entry.__typename === "Issue" || entry.__typename === "Discussion")
    ) {
      map.set(entry.id, entry as GraphNodeEntry);
    }
  }
  return { nodes: map, rateLimit: response?.rateLimit ?? null };
}

function toDbActor(owner: GraphNodeOwner | null | undefined): DbActor | null {
  if (!owner?.id) {
    return null;
  }
  return {
    id: owner.id,
    login: owner.login ?? null,
    name: owner.name ?? null,
    avatarUrl: owner.avatarUrl ?? null,
    createdAt: owner.createdAt ?? null,
    updatedAt: owner.updatedAt ?? null,
    __typename: owner.__typename ?? undefined,
  };
}

function toDbRepository(
  repoNode: GraphRepositoryNode,
  ownerId: string | null,
): DbRepository | null {
  if (!repoNode.id || !repoNode.nameWithOwner) {
    return null;
  }
  const name =
    repoNode.name ??
    repoNode.nameWithOwner.split("/").pop() ??
    repoNode.nameWithOwner;
  return {
    id: repoNode.id,
    name,
    nameWithOwner: repoNode.nameWithOwner,
    ownerId,
    url: repoNode.url ?? null,
    isPrivate: repoNode.isPrivate ?? null,
    createdAt: repoNode.createdAt ?? null,
    updatedAt: repoNode.updatedAt ?? null,
    raw: repoNode,
  };
}

async function ensureRepository(repo: GraphRepositoryNode | null | undefined) {
  if (!repo?.id || !repo.nameWithOwner) {
    return;
  }
  const owner = toDbActor(repo.owner);
  if (owner) {
    await upsertUser(owner);
  }
  const repoPayload = toDbRepository(repo, owner?.id ?? null);
  if (repoPayload) {
    await upsertRepository(repoPayload);
  }
}

async function ensureAuthor(actor: GraphNodeOwner | null | undefined) {
  const dbActor = toDbActor(actor);
  if (dbActor) {
    await upsertUser(dbActor);
  }
}

function toDbIssueFromIssueNode(node: GraphIssueNode): DbIssue | null {
  const repoId = node.repository?.id;
  if (!repoId) {
    return null;
  }
  return {
    id: node.id,
    number: node.number,
    repositoryId: repoId,
    authorId: node.author?.id ?? null,
    title: node.title ?? null,
    state: node.state ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    closedAt: node.closedAt ?? null,
    raw: node,
  };
}

async function processCandidateBatch(params: {
  client: GraphQLClient;
  candidates: IssueCandidateRow[];
  chunkSize: number;
  dryRun: boolean;
  logger?: SyncLogger;
  updatedIds: Set<string>;
  waitForRateLimit?: boolean;
  waitTimeoutMs?: number;
}): Promise<{ haltedByRateLimit: boolean }> {
  const {
    client,
    candidates,
    chunkSize,
    dryRun,
    logger,
    updatedIds,
    waitForRateLimit = false,
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  } = params;
  let haltedByRateLimit = false;
  const checkedIds = new Set<string>();

  for (const group of chunk(candidates, chunkSize)) {
    const { nodes: nodeMap, rateLimit } = await fetchNodeDetails(
      client,
      group.map((candidate) => candidate.id),
    );

    for (const candidate of group) {
      if (candidate.id) {
        checkedIds.add(candidate.id);
      }
      let resolvedUrl: string | null = null;
      let node = candidate.id ? (nodeMap.get(candidate.id) ?? null) : null;
      if ((!node || !node.id) && candidate.url) {
        const fallback = await resolveNodeFromUrl({
          client,
          url: candidate.url,
          logger,
        });
        if (fallback?.node) {
          node = fallback.node;
          resolvedUrl = fallback.resolvedUrl ?? null;
        }
      }
      if (!node || !node.id) {
        const mappedId = await findIssueIdByProjectItems({
          excludeId: candidate.id,
          projectItemIds: candidate.project_item_ids ?? null,
        });
        if (mappedId) {
          node = await fetchNodeById(client, mappedId);
          if (!resolvedUrl && typeof node?.url === "string") {
            resolvedUrl = node.url;
          }
        }
      }
      if (!node || !node.id) {
        logger?.(
          `[realign] Node ${candidate.id} could not be resolved (url=${candidate.url ?? "unknown"}). Skipping.`,
        );
        continue;
      }

      if (!isIssueNode(node) && !isDiscussionNode(node)) {
        logger?.(
          `[realign] Node ${candidate.id} is not an Issue or Discussion. Skipping.`,
        );
        continue;
      }

      const repoNode = node.repository;
      if (!repoNode?.id || !repoNode.nameWithOwner) {
        logger?.(
          `[realign] Node ${node.id} does not include repository details. Skipping.`,
        );
        continue;
      }

      const newUrl =
        resolvedUrl ??
        (typeof node.url === "string" ? node.url : candidate.url);
      const repoIdChanged = candidate.repository_id !== repoNode.id;
      const repoNameChanged = candidate.stored_repo !== repoNode.nameWithOwner;
      const urlChanged = (candidate.url ?? "") !== (newUrl ?? "");
      const nodeIdChanged = (candidate.id ?? null) !== node.id;

      if (!repoIdChanged && !repoNameChanged && !urlChanged && !nodeIdChanged) {
        if (candidate.ui_mismatch) {
          logger?.(
            `[realign] ${candidate.id}: URL (${candidate.url ?? "unknown"}) no longer resolves, but canonical data still matches ${repoNode.nameWithOwner}. Skipping.`,
          );
        }
        continue;
      }

      logger?.(
        `[realign] ${node.id}: repo ${candidate.stored_repo ?? "unknown"} -> ${repoNode.nameWithOwner} (repoIdChanged=${repoIdChanged}, nameChanged=${repoNameChanged}), url ${candidate.url ?? "unknown"} -> ${newUrl ?? "unknown"} (changed=${urlChanged}), nodeIdChanged=${nodeIdChanged}`,
      );

      if (dryRun) {
        continue;
      }

      if (nodeIdChanged && candidate.id) {
        await migrateIssueIdentity({
          oldId: candidate.id,
          newId: node.id,
          logger,
        });
        checkedIds.add(node.id);
      }

      await ensureRepository(repoNode);
      await ensureAuthor(node.author);

      let dbIssue: DbIssue | null = null;
      if (isIssueNode(node)) {
        dbIssue = toDbIssueFromIssueNode(node);
      } else if (isDiscussionNode(node)) {
        dbIssue = toDbIssueFromDiscussionNode(node);
      }

      if (!dbIssue) {
        logger?.(
          `[realign] Unable to build DbIssue payload for node ${node.id}. Skipping.`,
        );
        continue;
      }

      if (typeof newUrl === "string" && newUrl.length > 0) {
        const existingRaw =
          typeof dbIssue.raw === "object" && dbIssue.raw !== null
            ? (dbIssue.raw as Record<string, unknown>)
            : {};
        dbIssue.raw = { ...existingRaw, url: newUrl };
      }

      await upsertIssue(dbIssue);
      updatedIds.add(node.id);
      logger?.(
        `[realign] ${node.id}: upserted with repository ${dbIssue.repositoryId}.`,
      );
    }

    if (
      rateLimit?.remaining !== undefined &&
      rateLimit.remaining !== null &&
      rateLimit.remaining <= RATE_LIMIT_MIN_REMAINING
    ) {
      if (
        waitForRateLimit &&
        typeof rateLimit.resetAt === "string" &&
        rateLimit.resetAt.length > 0
      ) {
        const resetAt = new Date(rateLimit.resetAt).getTime();
        const now = Date.now();
        const waitMs = Math.max(resetAt - now, 0);
        if (waitMs > 0 && waitMs <= waitTimeoutMs) {
          logger?.(
            `[realign] Rate limit low (remaining: ${rateLimit.remaining}). Waiting ${Math.ceil(waitMs / 1000)}s for reset.`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }

      logger?.(
        `[realign] Stopping early to respect rate limit (remaining: ${rateLimit.remaining}).`,
      );
      haltedByRateLimit = true;
      break;
    }
  }

  if (!dryRun && checkedIds.size > 0) {
    await markOwnershipChecked(checkedIds);
  }

  return { haltedByRateLimit };
}

function toDbIssueFromDiscussionNode(
  node: GraphDiscussionNode,
): DbIssue | null {
  const repoId = node.repository?.id;
  if (!repoId) {
    return null;
  }
  const normalizedState = node.closedAt ? "closed" : "open";
  return {
    id: node.id,
    number: node.number,
    repositoryId: repoId,
    authorId: node.author?.id ?? null,
    title: node.title ?? null,
    state: normalizedState,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    closedAt: node.closedAt ?? null,
    raw: { ...node, __typename: "Discussion" },
  };
}

export async function realignRepositoryMismatches(
  options?: RepositoryRealignmentOptions,
): Promise<RepositoryRealignmentSummary> {
  const {
    limit = DEFAULT_LIMIT,
    chunkSize = DEFAULT_CHUNK_SIZE,
    dryRun = false,
    refreshArtifacts = false,
    logger,
    waitForRateLimit = false,
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    mode = "automatic",
    ids,
  } = options ?? {};

  const client = options?.client ?? createGithubClient();
  const updatedIds = new Set<string>();
  let totalCandidates = 0;
  let iteration = 0;

  while (true) {
    const candidates = await fetchOwnershipCheckCandidates(limit, ids);
    if (!candidates.length) {
      if (iteration === 0) {
        logger?.("[realign] No repository/url mismatches detected.");
      }
      break;
    }

    iteration += 1;
    totalCandidates += candidates.length;
    logger?.(
      `[realign] Pass #${iteration}: processing ${candidates.length} mismatched nodes.`,
    );

    const { haltedByRateLimit } = await processCandidateBatch({
      client,
      candidates,
      chunkSize,
      dryRun,
      logger,
      updatedIds,
      waitForRateLimit: waitForRateLimit || mode === "manual",
      waitTimeoutMs,
    });

    if (dryRun || haltedByRateLimit || candidates.length < limit) {
      break;
    }
  }

  if (!dryRun && updatedIds.size > 0 && refreshArtifacts) {
    const ids = Array.from(updatedIds);
    await refreshActivityItemsSnapshot({ ids });
    await refreshActivityCaches({ reason: "repository-realign" });
  }

  return {
    candidates: totalCandidates,
    updated: dryRun ? 0 : updatedIds.size,
    dryRun,
  };
}
