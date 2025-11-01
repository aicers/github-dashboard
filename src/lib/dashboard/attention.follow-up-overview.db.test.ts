// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import {
  getAttentionInsights,
  type ReviewRequestAttentionItem,
} from "@/lib/dashboard/attention";
import { buildFollowUpSummaries } from "@/lib/dashboard/attention-summaries";
import { upsertMentionClassification } from "@/lib/dashboard/unanswered-mention-classifications";
import { ensureSchema } from "@/lib/db";
import {
  type DbComment,
  type DbIssue,
  updateSyncConfig,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import {
  buildActor,
  buildPullRequest,
  buildRepository,
  buildReview,
  buildReviewRequest,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";

type ProjectStatusInput = {
  projectTitle: string;
  status: string;
  occurredAt: string;
};

function buildIssue(params: {
  id: string;
  number: number;
  repositoryId: string;
  repositoryNameWithOwner: string;
  authorId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  state?: string;
  assigneeIds?: string[];
  projectStatuses?: ProjectStatusInput[];
  closedAt?: string | null;
}): DbIssue {
  const {
    id,
    number,
    repositoryId,
    repositoryNameWithOwner,
    authorId,
    title,
    createdAt,
    updatedAt,
    state = "OPEN",
    assigneeIds = [],
    projectStatuses = [],
    closedAt = null,
  } = params;

  return {
    id,
    number,
    repositoryId,
    authorId,
    title,
    state,
    createdAt,
    updatedAt,
    closedAt,
    raw: {
      id,
      url: `https://github.com/${repositoryNameWithOwner}/issues/${number.toString()}`,
      title,
      projectStatusHistory: projectStatuses.map((status) => ({
        projectTitle: status.projectTitle,
        status: status.status,
        occurredAt: status.occurredAt,
      })),
      assignees: {
        nodes: assigneeIds.map((assigneeId) => ({ id: assigneeId })),
      },
    },
  } satisfies DbIssue;
}

function buildMentionComment(params: {
  id: string;
  authorId: string;
  pullRequestId?: string | null;
  issueId?: string | null;
  body: string;
  createdAt: string;
}): DbComment {
  const { id, authorId, pullRequestId, issueId, body, createdAt } = params;
  const pathSegment = pullRequestId
    ? `pull/${pullRequestId}`
    : `issues/${issueId ?? "unknown"}`;
  return {
    id,
    issueId: issueId ?? null,
    pullRequestId: pullRequestId ?? null,
    reviewId: null,
    authorId,
    createdAt,
    updatedAt: createdAt,
    raw: {
      id,
      url: `https://github.com/acme/main/${pathSegment}#comment-${id}`,
      body,
    },
  } satisfies DbComment;
}

function getCommentBody(comment: DbComment): string {
  const raw = comment.raw as { body?: unknown };
  const body = raw?.body;
  return typeof body === "string" ? body : "";
}

function hashCommentBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

describe("follow-up overview summaries (db)", () => {
  const originalTodoProjectName = env.TODO_PROJECT_NAME;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    env.TODO_PROJECT_NAME = "to-do list";
    await ensureSchema();
    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [],
      excludedUsers: [],
    });
  });

  afterEach(() => {
    env.TODO_PROJECT_NAME = originalTodoProjectName;
    vi.useRealTimers();
  });

  it("aggregates counts, totals, and highlight rankings across all sections", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");
    const dave = buildActor("user-dave", "dave", "Dave");
    const erin = buildActor("user-erin", "erin", "Erin");
    const frank = buildActor("user-frank", "frank", "Frank");
    const grace = buildActor("user-grace", "grace", "Grace");
    const hank = buildActor("user-hank", "hank", "Hank");

    for (const actor of [
      owner,
      alice,
      bob,
      carol,
      dave,
      erin,
      frank,
      grace,
      hank,
    ]) {
      await upsertUser(actor);
    }

    const mainRepo = buildRepository(
      "repo-main",
      "main",
      owner.id,
      owner.login ?? "owner",
    );
    await upsertRepository(mainRepo);

    const stalePrOne = buildPullRequest({
      id: "pr-stale-1",
      number: 101,
      repository: mainRepo,
      authorId: alice.id,
      title: "Legacy cleanup work",
      url: "https://github.com/acme/main/pull/101",
      createdAt: "2023-12-01T09:00:00.000Z",
      updatedAt: "2024-02-12T10:00:00.000Z",
    });
    const stalePrTwo = buildPullRequest({
      id: "pr-stale-2",
      number: 102,
      repository: mainRepo,
      authorId: bob.id,
      title: "Refine stale API",
      url: "https://github.com/acme/main/pull/102",
      createdAt: "2023-12-08T09:00:00.000Z",
      updatedAt: "2024-02-13T10:00:00.000Z",
    });

    const idlePrOne = buildPullRequest({
      id: "pr-idle-1",
      number: 201,
      repository: mainRepo,
      authorId: carol.id,
      title: "Idle caching tweak",
      url: "https://github.com/acme/main/pull/201",
      createdAt: "2024-01-31T09:00:00.000Z",
      updatedAt: "2024-01-31T09:00:00.000Z",
    });
    const idlePrTwo = buildPullRequest({
      id: "pr-idle-2",
      number: 202,
      repository: mainRepo,
      authorId: dave.id,
      title: "Idle pipeline fix",
      url: "https://github.com/acme/main/pull/202",
      createdAt: "2024-02-01T09:00:00.000Z",
      updatedAt: "2024-02-01T09:00:00.000Z",
    });

    const stuckPr = buildPullRequest({
      id: "pr-stuck-requests",
      number: 301,
      repository: mainRepo,
      authorId: alice.id,
      title: "Pending reviewer follow-up",
      url: "https://github.com/acme/main/pull/301",
      createdAt: "2024-02-01T09:00:00.000Z",
      updatedAt: "2024-02-10T09:00:00.000Z",
    });

    for (const pr of [stalePrOne, stalePrTwo, idlePrOne, idlePrTwo, stuckPr]) {
      await upsertPullRequest(pr);
    }

    const stuckReviewRequests = [
      buildReviewRequest({
        id: "rr-stuck-erin",
        pullRequestId: stuckPr.id,
        reviewerId: erin.id,
        requestedAt: "2024-02-05T09:00:00.000Z",
      }),
      buildReviewRequest({
        id: "rr-stuck-frank",
        pullRequestId: stuckPr.id,
        reviewerId: frank.id,
        requestedAt: "2024-02-06T09:00:00.000Z",
      }),
    ];

    for (const request of stuckReviewRequests) {
      await upsertReviewRequest(request);
    }

    const staleReviewCarol = buildReview({
      id: "review-stale-carol",
      pullRequestId: stalePrOne.id,
      authorId: carol.id,
      submittedAt: "2024-01-10T10:00:00.000Z",
      state: "COMMENTED",
    });
    const staleReviewBobPrimary = buildReview({
      id: "review-stale-bob-primary",
      pullRequestId: stalePrOne.id,
      authorId: bob.id,
      submittedAt: "2024-01-18T10:00:00.000Z",
      state: "COMMENTED",
    });
    const staleReviewBobSecondary = buildReview({
      id: "review-stale-bob",
      pullRequestId: stalePrTwo.id,
      authorId: bob.id,
      submittedAt: "2024-01-22T10:00:00.000Z",
      state: "COMMENTED",
    });
    await upsertReview(staleReviewCarol);
    await upsertReview(staleReviewBobPrimary);
    await upsertReview(staleReviewBobSecondary);

    const idleReviewErin = buildReview({
      id: "review-idle-erin",
      pullRequestId: idlePrOne.id,
      authorId: erin.id,
      submittedAt: "2024-02-01T12:00:00.000Z",
      state: "COMMENTED",
    });
    const idleReviewFrank = buildReview({
      id: "review-idle-frank",
      pullRequestId: idlePrTwo.id,
      authorId: frank.id,
      submittedAt: "2024-02-02T12:00:00.000Z",
      state: "COMMENTED",
    });
    await upsertReview(idleReviewErin);
    await upsertReview(idleReviewFrank);

    const backlogIssueOne = buildIssue({
      id: "issue-backlog-1",
      number: 401,
      repositoryId: mainRepo.id,
      repositoryNameWithOwner: mainRepo.nameWithOwner,
      authorId: alice.id,
      title: "Backlog overhaul task",
      createdAt: "2023-12-01T00:00:00.000Z",
      updatedAt: "2024-02-12T09:00:00.000Z",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: "2023-12-01T00:00:00.000Z",
        },
      ],
    });

    const backlogIssueTwo = buildIssue({
      id: "issue-backlog-2",
      number: 402,
      repositoryId: mainRepo.id,
      repositoryNameWithOwner: mainRepo.nameWithOwner,
      authorId: carol.id,
      title: "Second backlog refinement",
      createdAt: "2023-12-05T00:00:00.000Z",
      updatedAt: "2024-02-13T09:00:00.000Z",
      assigneeIds: [dave.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: "2023-12-05T00:00:00.000Z",
        },
      ],
    });

    const stalledIssueOne = buildIssue({
      id: "issue-stalled-1",
      number: 501,
      repositoryId: mainRepo.id,
      repositoryNameWithOwner: mainRepo.nameWithOwner,
      authorId: erin.id,
      title: "Feature stuck in progress",
      createdAt: "2023-12-10T00:00:00.000Z",
      updatedAt: "2024-02-12T09:00:00.000Z",
      assigneeIds: [frank.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: "2023-12-10T00:00:00.000Z",
        },
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: "2023-12-20T00:00:00.000Z",
        },
      ],
    });

    const stalledIssueTwo = buildIssue({
      id: "issue-stalled-2",
      number: 502,
      repositoryId: mainRepo.id,
      repositoryNameWithOwner: mainRepo.nameWithOwner,
      authorId: grace.id,
      title: "Analytics cleanup delayed",
      createdAt: "2024-01-05T00:00:00.000Z",
      updatedAt: "2024-02-14T09:00:00.000Z",
      assigneeIds: [hank.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: "2024-01-05T00:00:00.000Z",
        },
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: "2024-01-15T00:00:00.000Z",
        },
        {
          projectTitle: "to-do list",
          status: "Pending",
          occurredAt: "2024-01-25T00:00:00.000Z",
        },
      ],
    });

    for (const issue of [
      backlogIssueOne,
      backlogIssueTwo,
      stalledIssueOne,
      stalledIssueTwo,
    ]) {
      await upsertIssue(issue);
    }

    const unansweredPrComment = buildMentionComment({
      id: "comment-mention-grace",
      authorId: alice.id,
      pullRequestId: idlePrOne.id,
      body: "@grace Could you help with this review?",
      createdAt: "2024-02-07T09:00:00.000Z",
    });

    const unansweredIssueComment = buildMentionComment({
      id: "comment-mention-hank",
      authorId: bob.id,
      issueId: backlogIssueTwo.id,
      body: "@hank Any update on this backlog item?",
      createdAt: "2024-02-08T09:00:00.000Z",
    });

    for (const comment of [unansweredPrComment, unansweredIssueComment]) {
      await upsertComment(comment);
    }

    const mentionTargets = [
      { comment: unansweredPrComment, mentionedUserId: grace.id },
      { comment: unansweredIssueComment, mentionedUserId: hank.id },
    ];
    for (const { comment, mentionedUserId } of mentionTargets) {
      await upsertMentionClassification({
        commentId: comment.id,
        mentionedUserId,
        commentBodyHash: hashCommentBody(getCommentBody(comment)),
        requiresResponse: true,
        model: "test",
        rawResponse: { from: "test" },
      });
    }

    await refreshActivityItemsSnapshot({ truncate: true });

    const insights = await getAttentionInsights();

    expect(insights.staleOpenPrs).toHaveLength(2);
    expect(insights.idleOpenPrs).toHaveLength(2);
    expect(insights.stuckReviewRequests).toHaveLength(2);
    expect(insights.backlogIssues).toHaveLength(2);
    expect(insights.stalledInProgressIssues).toHaveLength(2);
    expect(insights.unansweredMentions).toHaveLength(2);

    const summaries = buildFollowUpSummaries(insights);
    const summaryMap = new Map(summaries.map((item) => [item.id, item]));

    const staleSummary = summaryMap.get("stale-open-prs");
    const idleSummary = summaryMap.get("idle-open-prs");
    const stuckSummary = summaryMap.get("stuck-review-requests");
    const backlogSummary = summaryMap.get("backlog-issues");
    const stalledSummary = summaryMap.get("stalled-in-progress-issues");
    const mentionSummary = summaryMap.get("unanswered-mentions");

    if (
      !staleSummary ||
      !idleSummary ||
      !stuckSummary ||
      !backlogSummary ||
      !stalledSummary ||
      !mentionSummary
    ) {
      throw new Error("Expected follow-up summaries for all sections");
    }

    expect(staleSummary.count).toBe(2);
    expect(staleSummary.totalMetric).toBe(
      insights.staleOpenPrs.reduce((total, pr) => total + (pr.ageDays ?? 0), 0),
    );
    expect(staleSummary.highlights).toContain(
      "최다 작성자: 1위 Alice, 2위 Bob",
    );
    expect(staleSummary.highlights).toContain(
      "최다 리뷰어: 1위 Bob, 2위 Carol",
    );

    expect(idleSummary.count).toBe(2);
    expect(idleSummary.totalMetric).toBe(
      insights.idleOpenPrs.reduce(
        (total, pr) => total + (pr.inactivityDays ?? pr.ageDays ?? 0),
        0,
      ),
    );
    expect(idleSummary.highlights).toContain(
      "최다 작성자: 1위 Carol, 2위 Dave",
    );
    expect(idleSummary.highlights).toContain(
      "최다 리뷰어: 1위 Erin, 2위 Frank",
    );

    const dedupedStuckRequests = Array.from(
      insights.stuckReviewRequests
        .reduce((map, request) => {
          const prId = (request.pullRequest.id ?? "").trim();
          const key = prId.length ? prId : request.id;
          const existing = map.get(key);
          if (
            !existing ||
            (request.waitingDays ?? 0) > (existing.waitingDays ?? 0)
          ) {
            map.set(key, request);
          }
          return map;
        }, new Map<string, ReviewRequestAttentionItem>())
        .values(),
    );

    expect(stuckSummary.count).toBe(dedupedStuckRequests.length);
    expect(stuckSummary.totalMetric).toBe(
      dedupedStuckRequests.reduce(
        (total, request) => total + (request.waitingDays ?? 0),
        0,
      ),
    );
    expect(stuckSummary.highlights).toContain("최다 작성자: 1위 Alice");
    const reviewerHighlight = stuckSummary.highlights.find((line) =>
      line.startsWith("최다 대기 리뷰어"),
    );
    expect(reviewerHighlight).toBeDefined();
    expect(reviewerHighlight).toContain("Erin");

    expect(backlogSummary.count).toBe(2);
    expect(backlogSummary.totalMetric).toBe(
      insights.backlogIssues.reduce(
        (total, issue) => total + (issue.ageDays ?? 0),
        0,
      ),
    );
    expect(backlogSummary.highlights).toContain(
      "최다 작성자: 1위 Alice, 2위 Carol",
    );
    expect(backlogSummary.highlights).toContain(
      "최다 담당자: 1위 Bob, 2위 Dave",
    );

    expect(stalledSummary.count).toBe(2);
    expect(stalledSummary.totalMetric).toBe(
      insights.stalledInProgressIssues.reduce(
        (total, issue) =>
          total + (issue.inProgressAgeDays ?? issue.ageDays ?? 0),
        0,
      ),
    );
    expect(stalledSummary.highlights).toContain(
      "최다 작성자: 1위 Erin, 2위 Grace",
    );
    expect(stalledSummary.highlights).toContain(
      "최다 담당자: 1위 Frank, 2위 Hank",
    );

    expect(mentionSummary.count).toBe(2);
    expect(mentionSummary.totalMetric).toBe(
      insights.unansweredMentions.reduce(
        (total, mention) => total + (mention.waitingDays ?? 0),
        0,
      ),
    );
    expect(mentionSummary.highlights).toContain(
      "최다 멘션 대상: 1위 Grace, 2위 Hank",
    );
    expect(mentionSummary.highlights).toContain(
      "최다 요청자: 1위 Alice, 2위 Bob",
    );
  });
});
