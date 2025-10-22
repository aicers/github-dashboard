// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ensureIssueStatusAutomation,
  getIssueStatusAutomationSummary,
} from "@/lib/activity/status-automation";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbPullRequest,
  type DbRepository,
  replacePullRequestIssues,
  updateSyncConfig,
} from "@/lib/db/operations";
import {
  insertIssueStatusHistory,
  resetActivityTables,
  seedActivityIssues,
  seedActivityPullRequests,
  seedActivityRepositories,
  seedActivityUsers,
} from "../../../tests/helpers/activity-data";

const USERS: DbActor[] = [
  {
    id: "user-1",
    login: "alice",
    name: "Alice",
    avatarUrl: null,
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T01:00:00.000Z",
  },
  {
    id: "user-2",
    login: "bob",
    name: "Bob",
    avatarUrl: null,
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T01:00:00.000Z",
  },
];

const REPOSITORIES: DbRepository[] = [
  {
    id: "repo-1",
    name: "alpha",
    nameWithOwner: "acme/alpha",
    ownerId: "user-1",
    url: "https://github.com/acme/alpha",
    isPrivate: false,
    createdAt: "2024-05-01T02:00:00.000Z",
    updatedAt: "2024-05-01T03:00:00.000Z",
    raw: {},
  },
];

const ISSUES: DbIssue[] = [
  {
    id: "issue-open",
    number: 101,
    repositoryId: "repo-1",
    authorId: "user-1",
    title: "Improve caching",
    state: "OPEN",
    createdAt: "2024-05-02T09:00:00.000Z",
    updatedAt: "2024-05-03T12:00:00.000Z",
    closedAt: null,
    raw: { url: "https://github.com/acme/alpha/issues/101" },
  },
  {
    id: "issue-closed",
    number: 102,
    repositoryId: "repo-1",
    authorId: "user-2",
    title: "Ship release",
    state: "CLOSED",
    createdAt: "2024-05-01T10:00:00.000Z",
    updatedAt: "2024-05-09T15:00:00.000Z",
    closedAt: "2024-05-09T15:00:00.000Z",
    raw: { url: "https://github.com/acme/alpha/issues/102" },
  },
  {
    id: "issue-unmerged",
    number: 104,
    repositoryId: "repo-1",
    authorId: "user-1",
    title: "Handle failed rollout",
    state: "CLOSED",
    createdAt: "2024-05-06T08:00:00.000Z",
    updatedAt: "2024-05-08T13:00:00.000Z",
    closedAt: "2024-05-08T13:00:00.000Z",
    raw: { url: "https://github.com/acme/alpha/issues/104" },
  },
  {
    id: "issue-locked",
    number: 103,
    repositoryId: "repo-1",
    authorId: "user-1",
    title: "Follow project plan",
    state: "OPEN",
    createdAt: "2024-05-03T08:00:00.000Z",
    updatedAt: "2024-05-03T09:00:00.000Z",
    closedAt: null,
    raw: { url: "https://github.com/acme/alpha/issues/103" },
  },
];

const PULL_REQUESTS: DbPullRequest[] = [
  {
    id: "pr-open",
    number: 201,
    repositoryId: "repo-1",
    authorId: "user-2",
    title: "Start implementation",
    state: "OPEN",
    merged: false,
    createdAt: "2024-05-04T11:00:00.000Z",
    updatedAt: "2024-05-04T12:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    raw: { url: "https://github.com/acme/alpha/pull/201" },
  },
  {
    id: "pr-merged",
    number: 202,
    repositoryId: "repo-1",
    authorId: "user-2",
    title: "Finish release",
    state: "MERGED",
    merged: true,
    createdAt: "2024-05-07T09:30:00.000Z",
    updatedAt: "2024-05-09T15:00:00.000Z",
    closedAt: "2024-05-09T15:00:00.000Z",
    mergedAt: "2024-05-09T15:00:00.000Z",
    raw: { url: "https://github.com/acme/alpha/pull/202" },
  },
  {
    id: "pr-closed",
    number: 204,
    repositoryId: "repo-1",
    authorId: "user-2",
    title: "Attempt risky change",
    state: "CLOSED",
    merged: false,
    createdAt: "2024-05-07T10:00:00.000Z",
    updatedAt: "2024-05-08T13:00:00.000Z",
    closedAt: "2024-05-08T13:00:00.000Z",
    mergedAt: null,
    raw: { url: "https://github.com/acme/alpha/pull/204" },
  },
  {
    id: "pr-locked",
    number: 203,
    repositoryId: "repo-1",
    authorId: "user-2",
    title: "Project-managed work",
    state: "OPEN",
    merged: false,
    createdAt: "2024-05-05T14:00:00.000Z",
    updatedAt: "2024-05-05T16:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    raw: { url: "https://github.com/acme/alpha/pull/203" },
  },
  {
    id: "pr-missing",
    number: 205,
    repositoryId: "repo-1",
    authorId: "user-2",
    title: "Link to missing issue",
    state: "OPEN",
    merged: false,
    createdAt: "2024-05-06T18:00:00.000Z",
    updatedAt: "2024-05-06T19:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    raw: { url: "https://github.com/acme/alpha/pull/205" },
  },
];

describe("ensureIssueStatusAutomation", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetActivityTables();
    await query(`TRUNCATE TABLE activity_cache_state`);
    await seedActivityUsers(USERS);
    await seedActivityRepositories(REPOSITORIES);
    await seedActivityIssues(ISSUES);
    await seedActivityPullRequests(PULL_REQUESTS);
    await replacePullRequestIssues("pr-open", [
      {
        issueId: "issue-open",
        issueNumber: 101,
        issueTitle: "Improve caching",
        issueState: "OPEN",
        issueUrl: "https://github.com/acme/alpha/issues/101",
        issueRepository: "acme/alpha",
      },
    ]);
    await replacePullRequestIssues("pr-merged", [
      {
        issueId: "issue-closed",
        issueNumber: 102,
        issueTitle: "Ship release",
        issueState: "CLOSED",
        issueUrl: "https://github.com/acme/alpha/issues/102",
        issueRepository: "acme/alpha",
      },
    ]);
    await replacePullRequestIssues("pr-locked", [
      {
        issueId: "issue-locked",
        issueNumber: 103,
        issueTitle: "Follow project plan",
        issueState: "OPEN",
        issueUrl: "https://github.com/acme/alpha/issues/103",
        issueRepository: "acme/alpha",
      },
    ]);
    await replacePullRequestIssues("pr-closed", [
      {
        issueId: "issue-unmerged",
        issueNumber: 104,
        issueTitle: "Handle failed rollout",
        issueState: "CLOSED",
        issueUrl: "https://github.com/acme/alpha/issues/104",
        issueRepository: "acme/alpha",
      },
    ]);
    await replacePullRequestIssues("pr-missing", [
      {
        issueId: "issue-missing",
        issueNumber: 999,
        issueTitle: "Ghost issue",
        issueState: "OPEN",
        issueUrl: "https://github.com/acme/alpha/issues/999",
        issueRepository: "acme/alpha",
      },
    ]);

    await insertIssueStatusHistory([
      {
        issueId: "issue-locked",
        status: "in_progress",
        occurredAt: "2024-05-05T14:00:00.000Z",
        source: "todo_project",
      },
    ]);

    await updateSyncConfig({
      lastSyncCompletedAt: "2024-05-10T12:00:00.000Z",
      lastSuccessfulSyncAt: "2024-05-10T12:00:00.000Z",
    });
  });

  it("applies in-progress and done statuses for synced issues", async () => {
    const result = await ensureIssueStatusAutomation({
      runId: 42,
      trigger: "test",
      force: true,
    });

    expect(result.processed).toBe(true);
    expect(result.insertedInProgress).toBe(3);
    expect(result.insertedDone).toBe(1);

    const history = await query<{
      issue_id: string;
      status: string;
      occurred_at: string;
      source: string;
    }>(
      `SELECT issue_id, status, occurred_at, source
         FROM activity_issue_status_history
         ORDER BY issue_id, occurred_at`,
    );

    const records = history.rows.map((row) => ({
      issueId: row.issue_id,
      status: row.status,
      occurredAt: new Date(row.occurred_at).toISOString(),
      source: row.source,
    }));

    expect(records).toEqual([
      {
        issueId: "issue-closed",
        status: "in_progress",
        occurredAt: "2024-05-07T09:30:00.000Z",
        source: "activity",
      },
      {
        issueId: "issue-closed",
        status: "done",
        occurredAt: "2024-05-09T15:00:00.000Z",
        source: "activity",
      },
      {
        issueId: "issue-locked",
        status: "in_progress",
        occurredAt: "2024-05-05T14:00:00.000Z",
        source: "todo_project",
      },
      {
        issueId: "issue-open",
        status: "in_progress",
        occurredAt: "2024-05-04T11:00:00.000Z",
        source: "activity",
      },
      {
        issueId: "issue-unmerged",
        status: "in_progress",
        occurredAt: "2024-05-07T10:00:00.000Z",
        source: "activity",
      },
    ]);

    const automationState = await query<{
      metadata: Record<string, unknown>;
    }>(
      `SELECT metadata
         FROM activity_cache_state
         WHERE cache_key = 'issue-status-automation'`,
    );

    expect(automationState.rowCount).toBe(1);
    const metadata = automationState.rows[0]?.metadata as Record<
      string,
      unknown
    >;
    expect(metadata).toMatchObject({
      status: "success",
      runId: 42,
      lastSuccessfulSyncAt: "2024-05-10T12:00:00.000Z",
      insertedInProgress: 3,
      insertedDone: 1,
      trigger: "test",
      lastSuccessSyncAt: "2024-05-10T12:00:00.000Z",
    });
    expect(typeof metadata.lastSuccessAt).toBe("string");

    const summary = await getIssueStatusAutomationSummary();
    expect(summary).not.toBeNull();
    expect(summary?.status).toBe("success");
    expect(summary?.runId).toBe(42);
    expect(summary?.syncRunId).toBe(42);
    expect(summary?.trigger).toBe("test");
    expect(summary?.lastSuccessfulSyncAt).toBe("2024-05-10T12:00:00.000Z");
    expect(summary?.lastSuccessSyncAt).toBe("2024-05-10T12:00:00.000Z");
    expect(summary?.lastSuccessAt).not.toBeNull();
    expect(summary?.insertedInProgress).toBe(3);
    expect(summary?.insertedDone).toBe(1);
    expect(summary?.itemCount).toBe(4);
    expect(summary?.generatedAt).not.toBeNull();
  });

  it("skips re-processing when automation is up-to-date", async () => {
    await ensureIssueStatusAutomation({ force: true });

    const result = await ensureIssueStatusAutomation();
    expect(result.processed).toBe(false);

    const historyCount = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM activity_issue_status_history`,
    );
    expect(historyCount.rows[0]?.count).toBe("5");
  });

  it("re-runs when last successful sync timestamp changes", async () => {
    await ensureIssueStatusAutomation({ force: true });
    await updateSyncConfig({
      lastSuccessfulSyncAt: "2024-05-11T10:00:00.000Z",
      lastSyncCompletedAt: "2024-05-11T10:00:00.000Z",
    });

    const result = await ensureIssueStatusAutomation();
    expect(result.processed).toBe(true);
  });

  it("does not mark done when closing pull request was not merged", async () => {
    await ensureIssueStatusAutomation({ force: true });
    const history = await query<{
      issue_id: string;
      status: string;
    }>(
      `SELECT issue_id, status
         FROM activity_issue_status_history
         WHERE issue_id = 'issue-unmerged'`,
    );

    const statuses = history.rows.map((row) => row.status);
    expect(statuses).toContain("in_progress");
    expect(statuses).not.toContain("done");
  });
});
