import { query, withTransaction } from "@/lib/db/client";

import type { RepositoryProfile, UserProfile } from "./types";

type UserProfileRow = {
  id: string;
  login: string | null;
  name: string | null;
  avatar_url: string | null;
};

export async function getUserProfiles(ids: string[]): Promise<UserProfile[]> {
  if (!ids.length) {
    return [];
  }

  const result = await query<UserProfileRow>(
    `SELECT id, login, name, avatar_url FROM users WHERE id = ANY($1::text[])`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  }));
}

export async function listAllUsers(): Promise<UserProfile[]> {
  const result = await query<UserProfileRow>(
    `SELECT id, login, name, avatar_url
     FROM users
     ORDER BY
       COALESCE(NULLIF(LOWER(login), ''), NULLIF(LOWER(name), ''), id),
       id`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  }));
}

type RepositoryProfileRow = {
  id: string;
  name: string | null;
  name_with_owner: string | null;
  maintainer_ids: string[] | null;
};

export async function getRepositoryProfiles(
  ids: string[],
): Promise<RepositoryProfile[]> {
  if (!ids.length) {
    return [];
  }

  const result = await query<RepositoryProfileRow>(
    `SELECT r.id,
            r.name,
            r.name_with_owner,
            COALESCE(
              ARRAY_AGG(m.user_id ORDER BY m.user_id)
                FILTER (WHERE m.user_id IS NOT NULL),
              '{}'::text[]
            ) AS maintainer_ids
     FROM repositories r
     LEFT JOIN repository_maintainers m ON m.repository_id = r.id
     WHERE r.id = ANY($1::text[])
     GROUP BY r.id, r.name, r.name_with_owner`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameWithOwner: row.name_with_owner,
    maintainerIds: Array.isArray(row.maintainer_ids) ? row.maintainer_ids : [],
  }));
}

export async function listAllRepositories(): Promise<RepositoryProfile[]> {
  const result = await query<RepositoryProfileRow>(
    `SELECT r.id,
            r.name,
            r.name_with_owner,
            COALESCE(
              ARRAY_AGG(m.user_id ORDER BY m.user_id)
                FILTER (WHERE m.user_id IS NOT NULL),
              '{}'::text[]
            ) AS maintainer_ids
     FROM repositories r
     LEFT JOIN repository_maintainers m ON m.repository_id = r.id
     GROUP BY r.id, r.name, r.name_with_owner
     ORDER BY r.name_with_owner NULLS LAST, r.name NULLS LAST, r.id`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameWithOwner: row.name_with_owner,
    maintainerIds: Array.isArray(row.maintainer_ids) ? row.maintainer_ids : [],
  }));
}

export async function replaceRepositoryMaintainers(
  assignments: Array<{ repositoryId: string; maintainerIds: string[] }>,
) {
  if (!assignments.length) {
    return;
  }

  const normalizedAssignments = assignments.map((assignment) => ({
    repositoryId:
      typeof assignment.repositoryId === "string"
        ? assignment.repositoryId.trim()
        : "",
    maintainerIds: Array.from(
      new Set(
        assignment.maintainerIds
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter((id): id is string => id.length > 0),
      ),
    ),
  }));

  const repositoryIds = normalizedAssignments
    .map((assignment) => assignment.repositoryId)
    .filter((id) => id.length > 0);

  if (!repositoryIds.length) {
    return;
  }

  const repositoryResult = await query<{ id: string }>(
    `SELECT id FROM repositories WHERE id = ANY($1::text[])`,
    [repositoryIds],
  );
  const validRepositoryIds = new Set(
    repositoryResult.rows.map((row) => row.id),
  );

  const filteredAssignments = normalizedAssignments.filter((assignment) =>
    validRepositoryIds.has(assignment.repositoryId),
  );

  if (!filteredAssignments.length) {
    return;
  }

  const allUserIds = Array.from(
    new Set(
      filteredAssignments.flatMap((assignment) => assignment.maintainerIds),
    ),
  );

  let validUserIds = new Set<string>();
  if (allUserIds.length) {
    const userResult = await query<{ id: string }>(
      `SELECT id FROM users WHERE id = ANY($1::text[])`,
      [allUserIds],
    );
    validUserIds = new Set(userResult.rows.map((row) => row.id));
  }

  await withTransaction(async (client) => {
    const targetRepositoryIds = filteredAssignments.map(
      (assignment) => assignment.repositoryId,
    );

    await client.query(
      `DELETE FROM repository_maintainers
       WHERE repository_id = ANY($1::text[])`,
      [targetRepositoryIds],
    );

    for (const assignment of filteredAssignments) {
      const maintainers = assignment.maintainerIds.filter((id) =>
        validUserIds.has(id),
      );

      if (!maintainers.length) {
        continue;
      }

      await client.query(
        `INSERT INTO repository_maintainers (repository_id, user_id)
         SELECT $1, candidate
         FROM UNNEST($2::text[]) AS candidate`,
        [assignment.repositoryId, maintainers],
      );
    }
  });
}
