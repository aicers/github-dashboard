// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { refreshActivitySocialSignals } from "@/lib/activity/social-signals";
import { query } from "@/lib/db/client";
import type {
  DbActor,
  DbComment,
  DbIssue,
  DbPullRequest,
  DbReaction,
  DbRepository,
} from "@/lib/db/operations";
import {
  resetActivityTables,
  seedActivityComments,
  seedActivityIssues,
  seedActivityPullRequests,
  seedActivityReactions,
  seedActivityRepositories,
  seedActivityUsers,
} from "../../../tests/helpers/activity-data";

describe("refreshActivitySocialSignals", () => {
  beforeEach(async () => {
    await resetActivityTables();
  });

  it("rebuilds social signal aggregates for issues and pull requests", async () => {
    const userAlice: DbActor = { id: "user-alice", login: "alice" };
    const userBob: DbActor = { id: "user-bob", login: "bob" };
    const userCharlie: DbActor = { id: "user-charlie", login: "charlie" };
    await seedActivityUsers([userAlice, userBob, userCharlie]);

    const repo: DbRepository = {
      id: "repo-1",
      name: "alpha",
      nameWithOwner: "octo/alpha",
      raw: { id: "repo-1" },
    };
    await seedActivityRepositories([repo]);

    const issueWithSignals: DbIssue = {
      id: "issue-1",
      number: 100,
      repositoryId: repo.id,
      authorId: userAlice.id,
      title: "Issue with comments",
      state: "OPEN",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      closedAt: null,
      raw: { __typename: "Issue", url: "https://example.com/issues/100" },
    };
    const issueWithoutSignals: DbIssue = {
      id: "issue-2",
      number: 101,
      repositoryId: repo.id,
      authorId: userBob.id,
      title: "Issue without social data",
      state: "OPEN",
      createdAt: "2024-01-02T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      closedAt: null,
      raw: { __typename: "Issue", url: "https://example.com/issues/101" },
    };
    await seedActivityIssues([issueWithSignals, issueWithoutSignals]);

    const pullRequestWithSignals: DbPullRequest = {
      id: "pr-1",
      number: 200,
      repositoryId: repo.id,
      authorId: userBob.id,
      title: "Add feature",
      state: "OPEN",
      createdAt: "2024-01-03T00:00:00.000Z",
      updatedAt: "2024-01-03T00:00:00.000Z",
      closedAt: null,
      mergedAt: null,
      merged: false,
      raw: { url: "https://example.com/pull/200" },
    };
    const pullRequestWithoutSignals: DbPullRequest = {
      id: "pr-2",
      number: 201,
      repositoryId: repo.id,
      authorId: userAlice.id,
      title: "Refactor code",
      state: "OPEN",
      createdAt: "2024-01-04T00:00:00.000Z",
      updatedAt: "2024-01-04T00:00:00.000Z",
      closedAt: null,
      mergedAt: null,
      merged: false,
      raw: { url: "https://example.com/pull/201" },
    };
    await seedActivityPullRequests([
      pullRequestWithSignals,
      pullRequestWithoutSignals,
    ]);

    const issueComment: DbComment = {
      id: "comment-issue-1",
      issueId: issueWithSignals.id,
      pullRequestId: null,
      reviewId: null,
      authorId: userAlice.id,
      createdAt: "2024-01-05T00:00:00.000Z",
      updatedAt: null,
      raw: { body: "Looks good @bob" },
    };
    const pullRequestComment: DbComment = {
      id: "comment-pr-1",
      issueId: null,
      pullRequestId: pullRequestWithSignals.id,
      reviewId: null,
      authorId: userBob.id,
      createdAt: "2024-01-06T00:00:00.000Z",
      updatedAt: null,
      raw: { body: "Please review this @alice" },
    };
    await seedActivityComments([issueComment, pullRequestComment]);

    const issueReaction: DbReaction = {
      id: "reaction-issue-1",
      subjectType: "Issue",
      subjectId: issueWithSignals.id,
      userId: userCharlie.id,
      content: "THUMBS_UP",
      createdAt: "2024-01-07T00:00:00.000Z",
      raw: {},
    };
    const pullRequestReaction: DbReaction = {
      id: "reaction-pr-1",
      subjectType: "PullRequest",
      subjectId: pullRequestWithSignals.id,
      userId: userAlice.id,
      content: "HEART",
      createdAt: "2024-01-08T00:00:00.000Z",
      raw: {},
    };
    await seedActivityReactions([issueReaction, pullRequestReaction]);

    await refreshActivitySocialSignals({ truncate: true });

    const participantRows = await query<{
      item_id: string;
      item_type: string;
      participant_ids: string[];
    }>(
      `SELECT item_id, item_type, participant_ids FROM activity_comment_participants`,
    );

    const participants = Object.fromEntries(
      participantRows.rows.map((row) => [
        row.item_id,
        {
          itemType: row.item_type,
          participants: Array.isArray(row.participant_ids)
            ? [...row.participant_ids].sort()
            : [],
        },
      ]),
    );

    expect(participants[issueWithSignals.id]).toEqual({
      itemType: "issue",
      participants: [userAlice.id],
    });
    expect(participants[issueWithoutSignals.id]).toEqual({
      itemType: "issue",
      participants: [],
    });
    expect(participants[pullRequestWithSignals.id]).toEqual({
      itemType: "pull_request",
      participants: [userBob.id],
    });
    expect(participants[pullRequestWithoutSignals.id]).toEqual({
      itemType: "pull_request",
      participants: [],
    });

    const mentionRows = await query<{
      item_id: string;
      mentioned_ids: string[];
    }>(`SELECT item_id, mentioned_ids FROM activity_comment_mentions`);

    const mentions = Object.fromEntries(
      mentionRows.rows.map((row) => [
        row.item_id,
        Array.isArray(row.mentioned_ids) ? [...row.mentioned_ids].sort() : [],
      ]),
    );

    expect(mentions[issueWithSignals.id]).toEqual([userBob.id]);
    expect(mentions[issueWithoutSignals.id]).toEqual([]);
    expect(mentions[pullRequestWithSignals.id]).toEqual([userAlice.id]);
    expect(mentions[pullRequestWithoutSignals.id]).toEqual([]);

    const reactionRows = await query<{
      item_id: string;
      reactor_ids: string[];
    }>(`SELECT item_id, reactor_ids FROM activity_reaction_users`);

    const reactors = Object.fromEntries(
      reactionRows.rows.map((row) => [
        row.item_id,
        Array.isArray(row.reactor_ids) ? [...row.reactor_ids].sort() : [],
      ]),
    );

    expect(reactors[issueWithSignals.id]).toEqual([userCharlie.id]);
    expect(reactors[issueWithoutSignals.id]).toEqual([]);
    expect(reactors[pullRequestWithSignals.id]).toEqual([userAlice.id]);
    expect(reactors[pullRequestWithoutSignals.id]).toEqual([]);

    const cacheState = await query<{
      cache_key: string;
      generated_at: string;
      item_count: number;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT cache_key, generated_at, item_count, metadata
         FROM activity_cache_state
        WHERE cache_key = 'social_signals_snapshot'`,
    );

    expect(cacheState.rowCount).toBe(1);
    const cacheRow = cacheState.rows[0];
    expect(cacheRow.item_count).toBe(4);
    expect(cacheRow.metadata).toMatchObject({
      mode: "truncate",
      participantRows: 4,
      mentionRows: 4,
      reactorRows: 4,
    });
  });
});
