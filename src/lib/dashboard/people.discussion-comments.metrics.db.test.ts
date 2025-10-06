// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildPeriodRanges,
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
  seedPersonAndRepo,
  shiftHours,
} from "../../../tests/helpers/dashboard-metrics";

describe("people discussion comment metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("counts comments made on issues and pull requests across periods", async () => {
    const { actor, repository } = await seedPersonAndRepo();
    const ranges = buildPeriodRanges(CURRENT_RANGE_START, CURRENT_RANGE_END);

    const issueAuthor: DbActor = {
      id: "comment-issue-author",
      login: "comment-issue-author",
      name: "Issue Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const prAuthor: DbActor = {
      id: "comment-pr-author",
      login: "comment-pr-author",
      name: "PR Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await Promise.all([upsertUser(issueAuthor), upsertUser(prAuthor)]);

    const commentCounts = {
      previous4: 2,
      previous3: 1,
      previous2: 3,
      previous: 2,
      current: 4,
    } as const;

    let issueNumber = 1;
    let prNumber = 1;
    for (const period of PERIOD_KEYS) {
      const { start } = ranges[period];
      const issue: DbIssue = {
        id: `${period}-comment-issue`,
        number: issueNumber,
        repositoryId: repository.id,
        authorId: issueAuthor.id,
        title: `Comment Issue ${issueNumber}`,
        state: "OPEN",
        createdAt: shiftHours(start, 1),
        updatedAt: shiftHours(start, 1),
        closedAt: null,
        raw: { title: `Comment Issue ${issueNumber}` },
      };
      issueNumber += 1;
      await upsertIssue(issue);

      const pullRequest: DbPullRequest = {
        id: `${period}-comment-pr`,
        number: prNumber,
        repositoryId: repository.id,
        authorId: prAuthor.id,
        title: `Comment PR ${prNumber}`,
        state: "OPEN",
        createdAt: shiftHours(start, 2),
        updatedAt: shiftHours(start, 2),
        closedAt: null,
        mergedAt: null,
        merged: false,
        raw: { title: `Comment PR ${prNumber}` },
      };
      prNumber += 1;
      await upsertPullRequest(pullRequest);

      for (let index = 0; index < commentCounts[period]; index += 1) {
        const targetIsIssue = index % 2 === 0;
        const createdAt = shiftHours(start, 4 + index * 3);
        const comment: DbComment = {
          id: `${period}-comment-${index}`,
          issueId: targetIsIssue ? issue.id : null,
          pullRequestId: targetIsIssue ? null : pullRequest.id,
          reviewId: null,
          authorId: actor.id,
          createdAt,
          updatedAt: createdAt,
          raw: { body: `Comment ${index}` },
        };
        await upsertComment(comment);
      }
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      personId: actor.id,
    });

    const individual = analytics.individual;
    expect(individual).not.toBeNull();
    if (!individual) {
      throw new Error("individual analytics missing");
    }
    const metric = individual.metrics.discussionComments;
    const history = individual.metricHistory.discussionComments;

    const expectedHistory = PERIOD_KEYS.map((period) => commentCounts[period]);

    expect(metric.current).toBe(commentCounts.current);
    expect(metric.previous).toBe(commentCounts.previous);
    expect(metric.absoluteChange).toBe(
      commentCounts.current - commentCounts.previous,
    );

    expect(history).toHaveLength(PERIOD_KEYS.length);
    history.forEach((entry, index) => {
      expect(entry.period).toBe(PERIOD_KEYS[index]);
      expect(entry.value).toBe(expectedHistory[index]);
    });
  });
});
