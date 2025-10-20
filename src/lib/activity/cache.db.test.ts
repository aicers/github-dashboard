// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getCachedActivityFilterOptions,
  getLinkedIssuesMap,
  getLinkedPullRequestsMap,
  refreshActivityCaches,
} from "@/lib/activity/cache";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbPullRequest,
  type DbRepository,
  replacePullRequestIssues,
} from "@/lib/db/operations";
import {
  resetActivityTables,
  seedActivityIssues,
  seedActivityPullRequests,
  seedActivityRepositories,
  seedActivityUsers,
} from "../../../tests/helpers/activity-data";

const USERS: DbActor[] = [
  {
    id: "user-alice",
    login: "alice",
    name: "Alice",
    avatarUrl: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  },
  {
    id: "user-bob",
    login: "bob",
    name: "Bob",
    avatarUrl: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  },
];

const REPOSITORIES: DbRepository[] = [
  {
    id: "repo-1",
    name: "alpha",
    nameWithOwner: "acme/alpha",
    ownerId: "user-alice",
    url: "https://github.com/acme/alpha",
    isPrivate: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    raw: {},
  },
];

const ISSUES: DbIssue[] = [
  {
    id: "issue-1",
    number: 101,
    repositoryId: "repo-1",
    authorId: "user-alice",
    title: "Improve caching",
    state: "OPEN",
    createdAt: "2024-01-03T00:00:00.000Z",
    updatedAt: "2024-01-04T00:00:00.000Z",
    closedAt: null,
    raw: {
      url: "https://github.com/acme/alpha/issues/101",
      labels: { nodes: [{ name: "Bug" }] },
    },
  },
];

const PULL_REQUESTS: DbPullRequest[] = [
  {
    id: "pr-1",
    number: 55,
    repositoryId: "repo-1",
    authorId: "user-bob",
    title: "Fix caching slowdown",
    state: "OPEN",
    merged: false,
    createdAt: "2024-01-05T00:00:00.000Z",
    updatedAt: "2024-01-06T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    raw: {
      url: "https://github.com/acme/alpha/pull/55",
      labels: { nodes: [{ name: "Bugfix" }] },
    },
  },
];

describe("activity cache refresh", () => {
  beforeEach(async () => {
    await resetActivityTables();
    await seedActivityUsers(USERS);
    await seedActivityRepositories(REPOSITORIES);
    await seedActivityIssues(ISSUES);
    await seedActivityPullRequests(PULL_REQUESTS);
    await replacePullRequestIssues("pr-1", [
      {
        issueId: "issue-1",
        issueNumber: 101,
        issueTitle: "Improve caching",
        issueState: "OPEN",
        issueUrl: "https://github.com/acme/alpha/issues/101",
        issueRepository: "acme/alpha",
      },
    ]);
  });

  it("refreshes filter options and link caches with metadata", async () => {
    const result = await refreshActivityCaches({
      runId: 42,
      reason: "test",
    });

    expect(result.filterOptions.syncRunId).toBe(42);
    expect(result.issueLinks.itemCount).toBeGreaterThanOrEqual(1);
    expect(result.pullRequestLinks.metadata.linkCount).toBe(1);

    const filterRow = await query<{
      generated_at: string;
      repository_count: number;
      label_count: number;
    }>(
      `SELECT generated_at, repository_count, label_count
         FROM activity_filter_options_cache
         WHERE id = 'default'`,
    );
    expect(filterRow.rows[0]?.repository_count).toBe(1);
    expect(filterRow.rows[0]?.label_count).toBeGreaterThanOrEqual(1);

    const stateRows = await query<{
      cache_key: string;
      sync_run_id: number | null;
      item_count: number | null;
    }>(
      `SELECT cache_key, sync_run_id, item_count
         FROM activity_cache_state
         ORDER BY cache_key`,
    );
    expect(stateRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cache_key: "activity-filter-options",
          sync_run_id: 42,
        }),
        expect.objectContaining({
          cache_key: "activity-issue-links",
          sync_run_id: 42,
          item_count: expect.any(Number),
        }),
        expect.objectContaining({
          cache_key: "activity-pull-request-links",
          sync_run_id: 42,
        }),
      ]),
    );

    const options = await getCachedActivityFilterOptions();
    expect(options.repositories.map((repo) => repo.id)).toEqual(["repo-1"]);

    const linkedPullRequests = await getLinkedPullRequestsMap(["issue-1"]);
    expect(linkedPullRequests.get("issue-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pr-1", status: "open" }),
      ]),
    );

    const linkedIssues = await getLinkedIssuesMap(["pr-1"]);
    expect(linkedIssues.get("pr-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "issue-1", number: 101 }),
      ]),
    );
  });
});
