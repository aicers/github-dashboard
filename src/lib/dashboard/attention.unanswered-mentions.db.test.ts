// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAttentionInsights } from "@/lib/dashboard/attention";
import { differenceInBusinessDays } from "@/lib/dashboard/business-days";
import { ensureSchema } from "@/lib/db";
import {
  type DbComment,
  type DbIssue,
  type DbReaction,
  updateSyncConfig,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildActor,
  buildPullRequest,
  buildRepository,
  buildReview,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";
const EXCLUDED_REPOSITORY_ID = "repo-excluded";
const EXCLUDED_TARGET_ID = "user-excluded-target";
const EXCLUDED_AUTHOR_ID = "user-excluded-author";

type IssueParams = {
  id: string;
  number: number;
  repositoryId: string;
  repositoryNameWithOwner: string;
  authorId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

function buildIssue(params: IssueParams): DbIssue {
  const {
    id,
    number,
    repositoryId,
    repositoryNameWithOwner,
    authorId,
    title,
    createdAt,
    updatedAt,
  } = params;

  return {
    id,
    number,
    repositoryId,
    authorId,
    title,
    state: "OPEN",
    createdAt,
    updatedAt,
    closedAt: null,
    raw: {
      id,
      number,
      title,
      url: `https://github.com/${repositoryNameWithOwner}/issues/${number.toString()}`,
    },
  } satisfies DbIssue;
}

function buildDiscussion(params: IssueParams): DbIssue {
  const issue = buildIssue(params);
  return {
    ...issue,
    raw: {
      ...(issue.raw as Record<string, unknown>),
      __typename: "Discussion",
      url: `https://github.com/${params.repositoryNameWithOwner}/discussions/${params.number.toString()}`,
    },
  };
}

describe("attention insights for unanswered mentions", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    await ensureSchema();
    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [EXCLUDED_REPOSITORY_ID],
      excludedUsers: [EXCLUDED_TARGET_ID, EXCLUDED_AUTHOR_ID],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unanswered mentions with business-day metrics while filtering responses and exclusions", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");
    const dave = buildActor("user-dave", "dave", "Dave");
    const erin = buildActor("user-erin", "erin", "Erin");
    const frank = buildActor("user-frank", "frank", "Frank");
    const quick = buildActor("user-quick", "quick", "Quick Responder");
    const excludedTarget = buildActor(
      EXCLUDED_TARGET_ID,
      "excluded-target",
      "Excluded Target",
    );
    const excludedAuthor = buildActor(
      EXCLUDED_AUTHOR_ID,
      "excluded-author",
      "Excluded Author",
    );

    for (const actor of [
      owner,
      alice,
      bob,
      carol,
      dave,
      erin,
      frank,
      quick,
      excludedTarget,
      excludedAuthor,
    ]) {
      await upsertUser(actor);
    }

    const mainRepo = buildRepository(
      "repo-main",
      "main",
      owner.id,
      owner.login ?? "owner",
    );
    const secondaryRepo = buildRepository(
      "repo-secondary",
      "secondary",
      owner.id,
      owner.login ?? "owner",
    );
    const excludedRepo = buildRepository(
      EXCLUDED_REPOSITORY_ID,
      "excluded",
      owner.id,
      owner.login ?? "owner",
    );

    for (const repo of [mainRepo, secondaryRepo, excludedRepo]) {
      await upsertRepository(repo);
    }

    const mainPr = buildPullRequest({
      id: "pr-main",
      number: 501,
      repository: mainRepo,
      authorId: alice.id,
      title: "Improve mention detection",
      url: "https://github.com/acme/main/pull/501",
      createdAt: "2024-01-10T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
    });
    const respondedCommentPr = buildPullRequest({
      id: "pr-comment-response",
      number: 502,
      repository: mainRepo,
      authorId: alice.id,
      title: "Comment response scenario",
      url: "https://github.com/acme/main/pull/502",
      createdAt: "2024-01-11T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
    });
    const respondedReviewPr = buildPullRequest({
      id: "pr-review-response",
      number: 503,
      repository: mainRepo,
      authorId: alice.id,
      title: "Review response scenario",
      url: "https://github.com/acme/main/pull/503",
      createdAt: "2024-01-12T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
    });
    const respondedReactionPr = buildPullRequest({
      id: "pr-reaction-response",
      number: 504,
      repository: secondaryRepo,
      authorId: alice.id,
      title: "Reaction response scenario",
      url: "https://github.com/acme/secondary/pull/504",
      createdAt: "2024-01-13T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
    });
    const excludedRepoPr = buildPullRequest({
      id: "pr-excluded-repo",
      number: 505,
      repository: excludedRepo,
      authorId: alice.id,
      title: "Excluded repository scenario",
      url: "https://github.com/acme/excluded/pull/505",
      createdAt: "2024-01-14T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
    });

    for (const pr of [
      mainPr,
      respondedCommentPr,
      respondedReviewPr,
      respondedReactionPr,
      excludedRepoPr,
    ]) {
      await upsertPullRequest(pr);
    }

    const mainIssue = buildIssue({
      id: "issue-main",
      number: 9001,
      repositoryId: mainRepo.id,
      repositoryNameWithOwner: mainRepo.nameWithOwner,
      authorId: bob.id,
      title: "Review deployment checklist",
      createdAt: "2024-01-15T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
    });
    await upsertIssue(mainIssue);

    const mainDiscussion = buildDiscussion({
      id: "discussion-main",
      number: 7001,
      repositoryId: mainRepo.id,
      repositoryNameWithOwner: mainRepo.nameWithOwner,
      authorId: alice.id,
      title: "Release coordination discussion",
      createdAt: "2024-01-16T00:00:00.000Z",
      updatedAt: "2024-02-09T00:00:00.000Z",
    });
    await upsertIssue(mainDiscussion);

    const targetReview = buildReview({
      id: "review-response",
      pullRequestId: respondedReviewPr.id,
      authorId: erin.id,
      submittedAt: "2024-02-12T09:00:00.000Z",
      state: "APPROVED",
    });
    await upsertReview(targetReview);

    const unansweredPrComment: DbComment = {
      id: "comment-pr-unanswered",
      issueId: null,
      pullRequestId: mainPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-pr-unanswered",
        url: "https://github.com/acme/main/pull/501#discussion_r1",
        body: "@bob Could you review this change and share feedback by tomorrow?",
      },
    } satisfies DbComment;

    const longBody = `@carol ${"Revisit deployment SOP and confirm rollout plan".repeat(5)} please.`;
    const unansweredIssueComment: DbComment = {
      id: "comment-issue-unanswered",
      issueId: mainIssue.id,
      pullRequestId: null,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-08T04:00:00.000Z",
      updatedAt: "2024-02-08T04:00:00.000Z",
      raw: {
        id: "comment-issue-unanswered",
        url: "https://github.com/acme/main/issues/9001#issuecomment-1",
        body: longBody,
      },
    } satisfies DbComment;

    const unansweredDiscussionComment: DbComment = {
      id: "comment-discussion-unanswered",
      issueId: mainDiscussion.id,
      pullRequestId: null,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-09T09:00:00.000Z",
      updatedAt: "2024-02-09T09:00:00.000Z",
      raw: {
        id: "comment-discussion-unanswered",
        url: "https://github.com/acme/main/discussions/7001#discussioncomment-1",
        body: "@bob Could you weigh in on the rollout timeline?",
      },
    } satisfies DbComment;

    const respondedByCommentMention: DbComment = {
      id: "comment-responded-comment",
      issueId: null,
      pullRequestId: respondedCommentPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-responded-comment",
        url: "https://github.com/acme/main/pull/502#discussion_r2",
        body: "@dave Friendly reminder to take a look at this change.",
      },
    } satisfies DbComment;

    const commentResponse: DbComment = {
      id: "comment-response-dave",
      issueId: null,
      pullRequestId: respondedCommentPr.id,
      reviewId: null,
      authorId: dave.id,
      createdAt: "2024-02-12T09:00:00.000Z",
      updatedAt: "2024-02-12T09:00:00.000Z",
      raw: {
        id: "comment-response-dave",
        url: "https://github.com/acme/main/pull/502#discussion_r3",
        body: "Looks good, I will follow up soon.",
      },
    } satisfies DbComment;

    const respondedByReviewMention: DbComment = {
      id: "comment-responded-review",
      issueId: null,
      pullRequestId: respondedReviewPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-responded-review",
        url: "https://github.com/acme/main/pull/503#discussion_r4",
        body: "@erin Can you approve this once you are back?",
      },
    } satisfies DbComment;

    const respondedByReactionMention: DbComment = {
      id: "comment-responded-reaction",
      issueId: null,
      pullRequestId: respondedReactionPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-responded-reaction",
        url: "https://github.com/acme/secondary/pull/504#discussion_r5",
        body: "@frank We still need your confirmation here.",
      },
    } satisfies DbComment;

    const reactionResponse: DbReaction = {
      id: "reaction-response",
      subjectType: "IssueComment",
      subjectId: respondedByReactionMention.id,
      userId: frank.id,
      content: "THUMBS_UP",
      createdAt: "2024-02-12T09:00:00.000Z",
      raw: {
        id: "reaction-response",
        subjectType: "IssueComment",
        subjectId: respondedByReactionMention.id,
        userId: frank.id,
        content: "THUMBS_UP",
        createdAt: "2024-02-12T09:00:00.000Z",
      },
    } satisfies DbReaction;

    const excludedRepoMention: DbComment = {
      id: "comment-excluded-repo",
      issueId: null,
      pullRequestId: excludedRepoPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-excluded-repo",
        url: "https://github.com/acme/excluded/pull/505#discussion_r6",
        body: "@bob This should be filtered via repository exclusion.",
      },
    } satisfies DbComment;

    const excludedTargetMention: DbComment = {
      id: "comment-excluded-target",
      issueId: null,
      pullRequestId: mainPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-excluded-target",
        url: "https://github.com/acme/main/pull/501#discussion_r7",
        body: "@excluded-target You are configured to be ignored.",
      },
    } satisfies DbComment;

    const excludedAuthorMention: DbComment = {
      id: "comment-excluded-author",
      issueId: null,
      pullRequestId: mainPr.id,
      reviewId: null,
      authorId: excludedAuthor.id,
      createdAt: "2024-02-07T09:00:00.000Z",
      updatedAt: "2024-02-07T09:00:00.000Z",
      raw: {
        id: "comment-excluded-author",
        url: "https://github.com/acme/main/pull/501#discussion_r8",
        body: "@bob Mention authored by excluded user should be ignored.",
      },
    } satisfies DbComment;

    const recentMention: DbComment = {
      id: "comment-recent",
      issueId: null,
      pullRequestId: mainPr.id,
      reviewId: null,
      authorId: alice.id,
      createdAt: "2024-02-16T09:00:00.000Z",
      updatedAt: "2024-02-16T09:00:00.000Z",
      raw: {
        id: "comment-recent",
        url: "https://github.com/acme/main/pull/501#discussion_r9",
        body: "@quick Mention that is not yet five business days old.",
      },
    } satisfies DbComment;

    for (const comment of [
      unansweredPrComment,
      unansweredIssueComment,
      unansweredDiscussionComment,
      respondedByCommentMention,
      commentResponse,
      respondedByReviewMention,
      respondedByReactionMention,
      excludedRepoMention,
      excludedTargetMention,
      excludedAuthorMention,
      recentMention,
    ]) {
      await upsertComment(comment);
    }

    await upsertReaction(reactionResponse);

    const insights = await getAttentionInsights();

    expect(insights.timezone).toBe("Asia/Seoul");
    expect(new Date(insights.generatedAt).toISOString()).toBe(FIXED_NOW);

    expect(insights.unansweredMentions).toHaveLength(3);

    const prItem = insights.unansweredMentions.find(
      (item) => item.commentId === unansweredPrComment.id,
    );
    const issueItem = insights.unansweredMentions.find(
      (item) => item.commentId === unansweredIssueComment.id,
    );
    const discussionItem = insights.unansweredMentions.find(
      (item) => item.commentId === unansweredDiscussionComment.id,
    );

    if (!prItem || !issueItem || !discussionItem) {
      throw new Error("Expected unanswered mention items to be present");
    }

    const now = new Date(FIXED_NOW);
    const expectedPrWaiting = differenceInBusinessDays(
      unansweredPrComment.createdAt,
      now,
    );
    const expectedIssueWaiting = differenceInBusinessDays(
      unansweredIssueComment.createdAt,
      now,
    );
    const expectedDiscussionWaiting = differenceInBusinessDays(
      unansweredDiscussionComment.createdAt,
      now,
    );

    expect(prItem.waitingDays).toBe(expectedPrWaiting);
    expect(issueItem.waitingDays).toBe(expectedIssueWaiting);
    expect(discussionItem.waitingDays).toBe(expectedDiscussionWaiting);

    expect(prItem.author).toEqual({
      id: alice.id,
      login: alice.login ?? null,
      name: alice.name ?? null,
    });
    expect(prItem.target).toEqual({
      id: bob.id,
      login: bob.login ?? null,
      name: bob.name ?? null,
    });
    expect(prItem.container).toEqual({
      type: "pull_request",
      id: mainPr.id,
      number: mainPr.number,
      title: mainPr.title,
      url: "https://github.com/acme/main/pull/501",
      repository: {
        id: mainRepo.id,
        name: mainRepo.name,
        nameWithOwner: mainRepo.nameWithOwner,
      },
    });
    expect(prItem.commentExcerpt).toBe(
      "@bob Could you review this change and share feedback by tomorrow?",
    );

    const normalizedLongBody = longBody.replace(/\s+/g, " ").trim();
    const expectedIssueExcerpt =
      normalizedLongBody.length <= 140
        ? normalizedLongBody
        : `${normalizedLongBody.slice(0, 137)}...`;

    expect(issueItem.author).toEqual({
      id: alice.id,
      login: alice.login ?? null,
      name: alice.name ?? null,
    });
    expect(issueItem.target).toEqual({
      id: carol.id,
      login: carol.login ?? null,
      name: carol.name ?? null,
    });
    expect(issueItem.container).toEqual({
      type: "issue",
      id: mainIssue.id,
      number: mainIssue.number,
      title: mainIssue.title,
      url: "https://github.com/owner/main/issues/9001",
      repository: {
        id: mainRepo.id,
        name: mainRepo.name,
        nameWithOwner: mainRepo.nameWithOwner,
      },
    });
    expect(issueItem.commentExcerpt).toBe(expectedIssueExcerpt);

    expect(discussionItem.author).toEqual({
      id: alice.id,
      login: alice.login ?? null,
      name: alice.name ?? null,
    });
    expect(discussionItem.target).toEqual({
      id: bob.id,
      login: bob.login ?? null,
      name: bob.name ?? null,
    });
    expect(discussionItem.container).toEqual({
      type: "discussion",
      id: mainDiscussion.id,
      number: mainDiscussion.number,
      title: mainDiscussion.title,
      url: "https://github.com/owner/main/discussions/7001",
      repository: {
        id: mainRepo.id,
        name: mainRepo.name,
        nameWithOwner: mainRepo.nameWithOwner,
      },
    });
    expect(discussionItem.commentExcerpt).toBe(
      "@bob Could you weigh in on the rollout timeline?",
    );
  });
});
