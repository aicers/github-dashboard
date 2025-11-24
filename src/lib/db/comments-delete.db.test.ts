// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureSchema, query } from "@/lib/db";
import {
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbReaction,
  deleteCommentsByIds,
  deleteMissingCommentsForTarget,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

describe("deleteMissingCommentsForTarget", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDashboardTables();
  });

  afterEach(async () => {
    await resetDashboardTables();
  });

  it("removes orphaned issue comments and related reactions", async () => {
    await upsertRepository({
      id: "repo-1",
      name: "repo",
      nameWithOwner: "acme/repo",
      raw: {},
    });
    await upsertUser({
      id: "user-a",
      login: "alice",
      name: "Alice",
      avatarUrl: null,
    });
    const issue: DbIssue = {
      id: "issue-1",
      number: 1,
      repositoryId: "repo-1",
      authorId: "user-a",
      title: "Test issue",
      state: "OPEN",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      closedAt: null,
      raw: {},
    };
    await upsertIssue(issue);

    const staleComment: DbComment = {
      id: "comment-stale",
      issueId: issue.id,
      createdAt: "2024-01-03T00:00:00.000Z",
      updatedAt: "2024-01-04T00:00:00.000Z",
      raw: {},
    };
    const activeComment: DbComment = {
      id: "comment-active",
      issueId: issue.id,
      createdAt: "2024-01-05T00:00:00.000Z",
      updatedAt: "2024-01-06T00:00:00.000Z",
      raw: {},
    };

    await upsertComment(staleComment);
    await upsertComment(activeComment);

    const reaction: DbReaction = {
      id: "reaction-1",
      subjectType: "IssueComment",
      subjectId: staleComment.id,
      userId: "user-a",
      content: "+1",
      createdAt: "2024-01-03T00:00:00.000Z",
      raw: {},
    };
    await upsertReaction(reaction);

    const deleted = await deleteMissingCommentsForTarget({
      issueId: issue.id,
      keepIds: [activeComment.id],
    });

    expect(deleted).toBe(1);

    const commentRows = await query<{ id: string }>(
      "SELECT id FROM comments ORDER BY id",
    );
    expect(commentRows.rows.map((row) => row.id)).toEqual([activeComment.id]);

    const reactionRows = await query("SELECT id FROM reactions");
    expect(reactionRows.rowCount).toBe(0);
  });

  it("limits deletion scope when filtering review comments", async () => {
    await upsertRepository({
      id: "repo-2",
      name: "repo",
      nameWithOwner: "acme/repo",
      raw: {},
    });
    await upsertUser({
      id: "user-a",
      login: "alice",
      name: "Alice",
      avatarUrl: null,
    });
    const pr: DbPullRequest = {
      id: "pr-1",
      number: 42,
      repositoryId: "repo-2",
      authorId: "user-a",
      title: "PR",
      state: "OPEN",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-02T00:00:00.000Z",
      closedAt: null,
      mergedAt: null,
      merged: null,
      raw: {},
    };
    await upsertPullRequest(pr);
    await upsertReview({
      id: "review-keep",
      pullRequestId: pr.id,
      authorId: "user-a",
      state: "APPROVED",
      submittedAt: "2024-02-02T00:00:00.000Z",
      raw: {},
    });
    await upsertReview({
      id: "review-drop",
      pullRequestId: pr.id,
      authorId: "user-a",
      state: "COMMENTED",
      submittedAt: "2024-02-02T00:00:00.000Z",
      raw: {},
    });

    const generalComment: DbComment = {
      id: "general-comment",
      pullRequestId: pr.id,
      createdAt: "2024-02-03T00:00:00.000Z",
      updatedAt: "2024-02-04T00:00:00.000Z",
      raw: {},
    };
    const reviewCommentKeep: DbComment = {
      id: "review-comment-keep",
      pullRequestId: pr.id,
      reviewId: "review-keep",
      createdAt: "2024-02-05T00:00:00.000Z",
      updatedAt: "2024-02-06T00:00:00.000Z",
      raw: {},
    };
    const reviewCommentDrop: DbComment = {
      id: "review-comment-drop",
      pullRequestId: pr.id,
      reviewId: "review-drop",
      createdAt: "2024-02-05T00:00:00.000Z",
      updatedAt: "2024-02-06T00:00:00.000Z",
      raw: {},
    };

    await upsertComment(generalComment);
    await upsertComment(reviewCommentKeep);
    await upsertComment(reviewCommentDrop);

    const deleted = await deleteMissingCommentsForTarget({
      pullRequestId: pr.id,
      keepIds: [reviewCommentKeep.id],
      scope: "review_only",
    });

    expect(deleted).toBe(1);

    const commentRows = await query<{ id: string; review_id: string | null }>(
      "SELECT id, review_id FROM comments ORDER BY id",
    );
    expect(commentRows.rows).toEqual([
      { id: generalComment.id, review_id: null },
      { id: reviewCommentKeep.id, review_id: "review-keep" },
    ]);
  });

  it("respects since bounds during deletion", async () => {
    await upsertRepository({
      id: "repo-3",
      name: "repo",
      nameWithOwner: "acme/repo",
      raw: {},
    });
    const issue: DbIssue = {
      id: "issue-2",
      number: 77,
      repositoryId: "repo-3",
      authorId: null,
      title: "Issue",
      state: "OPEN",
      createdAt: "2024-03-01T00:00:00.000Z",
      updatedAt: "2024-03-02T00:00:00.000Z",
      closedAt: null,
      raw: {},
    };
    await upsertIssue(issue);

    const oldComment: DbComment = {
      id: "old-comment",
      issueId: issue.id,
      createdAt: "2024-03-01T00:00:00.000Z",
      updatedAt: "2024-03-01T00:00:00.000Z",
      raw: {},
    };
    const recentComment: DbComment = {
      id: "recent-comment",
      issueId: issue.id,
      createdAt: "2024-03-10T00:00:00.000Z",
      updatedAt: "2024-03-10T00:00:00.000Z",
      raw: {},
    };

    await upsertComment(oldComment);
    await upsertComment(recentComment);

    const deleted = await deleteMissingCommentsForTarget({
      issueId: issue.id,
      since: "2024-03-05T00:00:00.000Z",
      keepIds: [],
    });

    expect(deleted).toBe(1);

    const commentRows = await query<{ id: string }>(
      "SELECT id FROM comments ORDER BY id",
    );
    expect(commentRows.rows.map((row) => row.id)).toEqual([oldComment.id]);
  });

  it("deletes comments directly by ids", async () => {
    await upsertRepository({
      id: "repo-4",
      name: "repo",
      nameWithOwner: "acme/repo",
      raw: {},
    });
    const issue: DbIssue = {
      id: "issue-4",
      number: 77,
      repositoryId: "repo-4",
      authorId: null,
      title: "Issue",
      state: "OPEN",
      createdAt: "2024-04-01T00:00:00.000Z",
      updatedAt: "2024-04-02T00:00:00.000Z",
      closedAt: null,
      raw: {},
    };
    await upsertIssue(issue);

    const target: DbComment = {
      id: "comment-remove-direct",
      issueId: issue.id,
      createdAt: "2024-04-03T00:00:00.000Z",
      updatedAt: "2024-04-03T00:00:00.000Z",
      raw: {},
    };
    await upsertComment(target);
    await upsertReaction({
      id: "reaction-direct",
      subjectType: "IssueComment",
      subjectId: target.id,
      createdAt: "2024-04-03T00:00:00.000Z",
      userId: null,
      content: "THUMBS_UP",
      raw: {},
    });

    const deleted = await deleteCommentsByIds([target.id]);
    expect(deleted).toBe(1);

    const commentRows = await query("SELECT id FROM comments WHERE id = $1", [
      target.id,
    ]);
    expect(commentRows.rowCount).toBe(0);

    const reactionRows = await query(
      "SELECT id FROM reactions WHERE id = 'reaction-direct'",
    );
    expect(reactionRows.rowCount).toBe(0);
  });
});
