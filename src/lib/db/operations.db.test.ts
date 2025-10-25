import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { query } from "@/lib/db/client";
import {
  type DbActor,
  getUserAvatarState,
  replacePullRequestIssues,
  updateUserAvatarUrl,
  upsertUser,
} from "@/lib/db/operations";

const TEST_USER_ID = "user_123";

afterEach(async () => {
  await query("TRUNCATE TABLE users, user_preferences CASCADE");
});

describe("db operations", () => {
  it("upsertUser stores actor data", async () => {
    const actor: DbActor = {
      id: TEST_USER_ID,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://example.com/avatar.png",
      createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2024-02-01T00:00:00Z").toISOString(),
    };

    await upsertUser(actor);

    const result = await query(
      "SELECT id, login, name, avatar_url, github_created_at, github_updated_at FROM users WHERE id = $1",
      [TEST_USER_ID],
    );

    expect(result.rowCount).toBe(1);
    const row = result.rows[0];
    expect(row.id).toBe(actor.id);
    expect(row.login).toBe("octocat");
    expect(row.name).toBe("The Octocat");
    expect(row.avatar_url).toBe("https://example.com/avatar.png");
    expect(row.github_created_at?.toISOString()).toBe(actor.createdAt);
    expect(row.github_updated_at?.toISOString()).toBe(actor.updatedAt);
  });

  it("preserves custom avatar uploads across GitHub syncs", async () => {
    const actor: DbActor = {
      id: TEST_USER_ID,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://github.com/original.png",
      createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2024-02-01T00:00:00Z").toISOString(),
    };

    await upsertUser(actor);

    const uploadState = await updateUserAvatarUrl(
      TEST_USER_ID,
      "/uploads/avatars/custom.png",
    );
    expect(uploadState.avatarUrl).toBe("/uploads/avatars/custom.png");
    expect(uploadState.customAvatarUrl).toBe("/uploads/avatars/custom.png");
    expect(uploadState.originalAvatarUrl).toBe(
      "https://github.com/original.png",
    );

    await upsertUser({
      ...actor,
      avatarUrl: "https://github.com/new-original.png",
      updatedAt: new Date("2024-03-01T00:00:00Z").toISOString(),
    });

    const userRow = await query<{ avatar_url: string | null; data: unknown }>(
      "SELECT avatar_url, data FROM users WHERE id = $1",
      [TEST_USER_ID],
    );

    expect(userRow.rowCount).toBe(1);
    expect(userRow.rows[0].avatar_url).toBe("/uploads/avatars/custom.png");
    const stored = userRow.rows[0].data as {
      profile?: {
        originalAvatarUrl?: string | null;
        customAvatarUrl?: string | null;
      };
    };
    expect(stored.profile?.customAvatarUrl).toBe("/uploads/avatars/custom.png");
    expect(stored.profile?.originalAvatarUrl).toBe(
      "https://github.com/new-original.png",
    );

    const removalState = await updateUserAvatarUrl(TEST_USER_ID, null);
    expect(removalState.customAvatarUrl).toBeNull();
    expect(removalState.avatarUrl).toBe("https://github.com/new-original.png");

    const avatarState = await getUserAvatarState(TEST_USER_ID);
    expect(avatarState.avatarUrl).toBe("https://github.com/new-original.png");
    expect(avatarState.originalAvatarUrl).toBe(
      "https://github.com/new-original.png",
    );
    expect(avatarState.customAvatarUrl).toBeNull();
  });
});

describe("replacePullRequestIssues", () => {
  const repositoryId = "repo_123";
  const pullRequestId = "pr_123";

  beforeEach(async () => {
    await query(
      `INSERT INTO repositories (
         id,
         name,
         name_with_owner,
         data,
         github_created_at,
         github_updated_at
       ) VALUES ($1, $2, $3, '{}'::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [repositoryId, "demo", "acme/demo"],
    );

    await query(
      `INSERT INTO pull_requests (
         id,
         number,
         repository_id,
         github_created_at,
         github_updated_at,
         data
       ) VALUES ($1, 1, $2, NOW(), NOW(), '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [pullRequestId, repositoryId],
    );
  });

  afterEach(async () => {
    await query("TRUNCATE TABLE pull_request_issues, pull_requests CASCADE");
    await query("TRUNCATE TABLE repositories CASCADE");
  });

  it("replaces linked issues for a pull request", async () => {
    await replacePullRequestIssues(pullRequestId, [
      {
        issueId: "issue-1",
        issueNumber: 42,
        issueTitle: "First issue",
        issueState: "OPEN",
        issueUrl: "https://github.com/acme/demo/issues/42",
        issueRepository: "acme/demo",
      },
      {
        issueId: "issue-2",
        issueNumber: 43,
        issueTitle: "Second issue",
        issueState: "CLOSED",
        issueUrl: "https://github.com/acme/demo/issues/43",
        issueRepository: "acme/demo",
      },
    ]);

    const initial = await query(
      `SELECT issue_id, issue_number, issue_title, issue_state, issue_url, issue_repository
         FROM pull_request_issues
        WHERE pull_request_id = $1
        ORDER BY issue_id`,
      [pullRequestId],
    );

    expect(initial.rows).toEqual([
      {
        issue_id: "issue-1",
        issue_number: 42,
        issue_title: "First issue",
        issue_state: "OPEN",
        issue_url: "https://github.com/acme/demo/issues/42",
        issue_repository: "acme/demo",
      },
      {
        issue_id: "issue-2",
        issue_number: 43,
        issue_title: "Second issue",
        issue_state: "CLOSED",
        issue_url: "https://github.com/acme/demo/issues/43",
        issue_repository: "acme/demo",
      },
    ]);

    await replacePullRequestIssues(pullRequestId, [
      {
        issueId: "issue-2",
        issueNumber: 43,
        issueTitle: "Second issue updated",
        issueState: "CLOSED",
        issueUrl: "https://github.com/acme/demo/issues/43",
        issueRepository: "acme/demo",
      },
    ]);

    const updated = await query(
      `SELECT issue_id, issue_number, issue_title, issue_state, issue_url, issue_repository
         FROM pull_request_issues
        WHERE pull_request_id = $1`,
      [pullRequestId],
    );

    expect(updated.rows).toEqual([
      {
        issue_id: "issue-2",
        issue_number: 43,
        issue_title: "Second issue updated",
        issue_state: "CLOSED",
        issue_url: "https://github.com/acme/demo/issues/43",
        issue_repository: "acme/demo",
      },
    ]);

    await replacePullRequestIssues(pullRequestId, []);

    const cleared = await query(
      `SELECT COUNT(*)::int AS count FROM pull_request_issues WHERE pull_request_id = $1`,
      [pullRequestId],
    );

    expect(cleared.rows[0]?.count).toBe(0);
  });
});
