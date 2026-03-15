import { query } from "@/lib/db/client";
import { getRepositoryProfiles, getUserProfiles } from "./profiles";
import type {
  DashboardSummary,
  RangeSummary,
  TableCountKey,
  TableCountSummary,
} from "./types";

type CountRow = {
  type: TableCountKey;
  count: string;
};

export async function getCountsByTable(): Promise<TableCountSummary[]> {
  const result = await query<CountRow>(
    `SELECT 'issues' AS type, COUNT(*)::bigint AS count FROM issues
     UNION ALL
     SELECT 'pull_requests', COUNT(*)::bigint FROM pull_requests
     UNION ALL
     SELECT 'reviews', COUNT(*)::bigint FROM reviews
     UNION ALL
     SELECT 'comments', COUNT(*)::bigint FROM comments`,
  );
  return result.rows.map((row) => ({
    type: row.type,
    count: Number(row.count),
  }));
}

export async function getTimeRangeByTable(
  table: "issues" | "pull_requests",
): Promise<RangeSummary> {
  const result = await query<RangeSummary>(
    `SELECT MIN(github_created_at) AS oldest, MAX(github_updated_at) AS newest FROM ${table}`,
  );
  const row = result.rows[0];
  return {
    oldest: row?.oldest ?? null,
    newest: row?.newest ?? null,
  };
}

type TopUserRow = {
  author_id: string;
  issue_count: string;
};

export async function getTopUsersByIssues(limit = 5): Promise<TopUserRow[]> {
  const result = await query<TopUserRow>(
    `SELECT author_id, COUNT(*)::bigint AS issue_count
     FROM issues
     WHERE author_id IS NOT NULL
     GROUP BY author_id
     ORDER BY issue_count DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

type TopRepositoryRow = {
  repository_id: string;
  issue_count: string;
  pull_request_count: string;
};

export async function getTopRepositoriesByActivity(
  limit = 5,
): Promise<TopRepositoryRow[]> {
  const result = await query<TopRepositoryRow>(
    `SELECT repository_id,
            SUM(CASE WHEN type = 'issue' THEN count ELSE 0 END) AS issue_count,
            SUM(CASE WHEN type = 'pr' THEN count ELSE 0 END) AS pull_request_count
     FROM (
       SELECT repository_id, COUNT(*)::bigint AS count, 'issue' AS type
       FROM issues
       GROUP BY repository_id
       UNION ALL
       SELECT repository_id, COUNT(*)::bigint AS count, 'pr' AS type
       FROM pull_requests
       GROUP BY repository_id
     ) AS combined
     GROUP BY repository_id
     ORDER BY (SUM(count)) DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getDashboardStats(): Promise<DashboardSummary> {
  const [counts, issuesRange, prsRange, topUsers, topRepos] = await Promise.all(
    [
      getCountsByTable(),
      getTimeRangeByTable("issues"),
      getTimeRangeByTable("pull_requests"),
      getTopUsersByIssues(5),
      getTopRepositoriesByActivity(5),
    ],
  );

  const userIds = topUsers
    .map((row) => row.author_id)
    .filter((value): value is string => Boolean(value));
  const repositoryIds = topRepos
    .map((row) => row.repository_id)
    .filter((value): value is string => Boolean(value));

  const [userProfiles, repositoryProfiles] = await Promise.all([
    getUserProfiles(userIds),
    getRepositoryProfiles(repositoryIds),
  ]);

  const userMap = new Map(userProfiles.map((profile) => [profile.id, profile]));
  const repositoryMap = new Map(
    repositoryProfiles.map((profile) => [profile.id, profile]),
  );

  return {
    counts,
    issuesRange,
    pullRequestsRange: prsRange,
    topUsers: topUsers.map((row) => ({
      authorId: row.author_id,
      issueCount: Number(row.issue_count),
      profile: userMap.get(row.author_id) ?? null,
    })),
    topRepositories: topRepos.map((row) => ({
      repositoryId: row.repository_id,
      issueCount: Number(row.issue_count),
      pullRequestCount: Number(row.pull_request_count),
      repository: repositoryMap.get(row.repository_id) ?? null,
    })),
  };
}

export async function getDataFreshness() {
  const result = await query(
    `SELECT last_successful_sync_at FROM sync_config WHERE id = 'default'`,
  );
  return result.rows[0]?.last_successful_sync_at ?? null;
}
