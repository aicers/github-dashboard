import type { GraphQLClient } from "graphql-request";

import { upsertRepository } from "@/lib/db/operations";
import { organizationRepositoriesQuery } from "@/lib/github/queries";

import type {
  OrganizationRepositoriesQueryResponse,
  RepositoryNode,
  SyncOptions,
} from "./types";
import { maxTimestamp, processActor, requestWithRetry } from "./utils";

export async function collectRepositories(
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

export async function ensureRepositoryRecord(
  repository?: RepositoryNode | null,
) {
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
