// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  updateSyncConfig,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  resetDashboardTables,
  seedPersonAndRepo,
} from "../../../tests/helpers/people-metrics";

describe("people activity heatmap", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("combines activity sources for an individual and honors filters and repository selection", async () => {
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [],
      excludedUsers: [],
    });

    const { actor, repository: targetRepository } = await seedPersonAndRepo();

    const otherRepository: DbRepository = {
      id: "person-activity-other-repo",
      name: "person-activity-other-repo",
      nameWithOwner: "octo/person-activity-other-repo",
      ownerId: actor.id,
      raw: { id: "person-activity-other-repo" },
    };
    await upsertRepository(otherRepository);

    const otherAuthor: DbActor = {
      id: "person-activity-author",
      login: "activity-author",
      name: "Activity Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabotAuthor: DbActor = {
      id: "activity-dependabot",
      login: "dependabot-preview[bot]",
      name: "Dependabot Preview",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };

    await Promise.all([upsertUser(otherAuthor), upsertUser(dependabotAuthor)]);

    const issues: DbIssue[] = [
      {
        id: "target-activity-issue",
        number: 1001,
        repositoryId: targetRepository.id,
        authorId: actor.id,
        title: "Target Issue",
        state: "OPEN",
        createdAt: "2024-01-02T00:10:00.000Z",
        updatedAt: "2024-01-02T00:10:00.000Z",
        raw: { id: "target-activity-issue" },
      },
      {
        id: "other-activity-issue",
        number: 2001,
        repositoryId: otherRepository.id,
        authorId: actor.id,
        title: "Other Issue",
        state: "OPEN",
        createdAt: "2024-01-02T03:00:00.000Z",
        updatedAt: "2024-01-02T03:00:00.000Z",
        raw: { id: "other-activity-issue" },
      },
    ];

    for (const issue of issues) {
      await upsertIssue(issue);
    }

    const pullRequests: DbPullRequest[] = [
      {
        id: "target-activity-created-pr",
        number: 1101,
        repositoryId: targetRepository.id,
        authorId: actor.id,
        title: "Target Authored PR",
        state: "OPEN",
        createdAt: "2024-01-02T00:20:00.000Z",
        updatedAt: "2024-01-02T00:20:00.000Z",
        raw: { id: "target-activity-created-pr" },
      },
      {
        id: "other-activity-created-pr",
        number: 2101,
        repositoryId: otherRepository.id,
        authorId: actor.id,
        title: "Other Authored PR",
        state: "OPEN",
        createdAt: "2024-01-02T03:30:00.000Z",
        updatedAt: "2024-01-02T03:30:00.000Z",
        raw: { id: "other-activity-created-pr" },
      },
      {
        id: "target-activity-merged-pr",
        number: 1201,
        repositoryId: targetRepository.id,
        authorId: otherAuthor.id,
        title: "Target Merged PR",
        state: "MERGED",
        createdAt: "2024-01-02T04:00:00.000Z",
        updatedAt: "2024-01-03T05:00:00.000Z",
        mergedAt: "2024-01-03T05:00:00.000Z",
        merged: true,
        raw: { id: "target-activity-merged-pr", mergedBy: { id: actor.id } },
      },
      {
        id: "other-activity-merged-pr",
        number: 2201,
        repositoryId: otherRepository.id,
        authorId: otherAuthor.id,
        title: "Other Merged PR",
        state: "MERGED",
        createdAt: "2024-01-02T04:30:00.000Z",
        updatedAt: "2024-01-05T01:00:00.000Z",
        mergedAt: "2024-01-05T01:00:00.000Z",
        merged: true,
        raw: { id: "other-activity-merged-pr", mergedBy: { id: actor.id } },
      },
      {
        id: "target-activity-review-pr",
        number: 1301,
        repositoryId: targetRepository.id,
        authorId: otherAuthor.id,
        title: "Target Review PR",
        state: "OPEN",
        createdAt: "2024-01-02T06:00:00.000Z",
        updatedAt: "2024-01-02T06:00:00.000Z",
        raw: { id: "target-activity-review-pr" },
      },
      {
        id: "other-activity-review-pr",
        number: 2301,
        repositoryId: otherRepository.id,
        authorId: otherAuthor.id,
        title: "Other Review PR",
        state: "OPEN",
        createdAt: "2024-01-02T06:30:00.000Z",
        updatedAt: "2024-01-02T06:30:00.000Z",
        raw: { id: "other-activity-review-pr" },
      },
      {
        id: "dependabot-activity-review-pr",
        number: 2401,
        repositoryId: targetRepository.id,
        authorId: dependabotAuthor.id,
        title: "Dependabot Review PR",
        state: "OPEN",
        createdAt: "2024-01-02T07:00:00.000Z",
        updatedAt: "2024-01-02T07:00:00.000Z",
        raw: { id: "dependabot-activity-review-pr" },
      },
      {
        id: "dependabot-activity-merged-pr",
        number: 2501,
        repositoryId: targetRepository.id,
        authorId: dependabotAuthor.id,
        title: "Dependabot Merged PR",
        state: "MERGED",
        createdAt: "2024-01-02T07:30:00.000Z",
        updatedAt: "2024-01-06T02:30:00.000Z",
        mergedAt: "2024-01-06T02:30:00.000Z",
        merged: true,
        raw: {
          id: "dependabot-activity-merged-pr",
          mergedBy: { id: actor.id },
        },
      },
    ];

    for (const pullRequest of pullRequests) {
      await upsertPullRequest(pullRequest);
    }

    const reviews: DbReview[] = [
      {
        id: "activity-review-target",
        pullRequestId: "target-activity-review-pr",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: "2024-01-03T05:30:00.000Z",
        raw: { id: "activity-review-target" },
      },
      {
        id: "activity-review-other",
        pullRequestId: "other-activity-review-pr",
        authorId: actor.id,
        state: "COMMENTED",
        submittedAt: "2024-01-04T02:10:00.000Z",
        raw: { id: "activity-review-other" },
      },
      {
        id: "activity-review-dependabot",
        pullRequestId: "dependabot-activity-review-pr",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: "2024-01-06T02:00:00.000Z",
        raw: { id: "activity-review-dependabot" },
      },
    ];

    for (const review of reviews) {
      await upsertReview(review);
    }

    const comments: DbComment[] = [
      {
        id: "activity-comment-target-issue",
        issueId: "target-activity-issue",
        authorId: actor.id,
        createdAt: "2024-01-02T01:15:00.000Z",
        updatedAt: "2024-01-02T01:15:00.000Z",
        raw: { id: "activity-comment-target-issue" },
      },
      {
        id: "activity-comment-target-pr",
        pullRequestId: "target-activity-review-pr",
        authorId: actor.id,
        createdAt: "2024-01-02T01:45:00.000Z",
        updatedAt: "2024-01-02T01:45:00.000Z",
        raw: { id: "activity-comment-target-pr" },
      },
      {
        id: "activity-comment-other-issue",
        issueId: "other-activity-issue",
        authorId: actor.id,
        createdAt: "2024-01-02T04:00:00.000Z",
        updatedAt: "2024-01-02T04:00:00.000Z",
        raw: { id: "activity-comment-other-issue" },
      },
      {
        id: "activity-comment-other-pr",
        pullRequestId: "other-activity-review-pr",
        authorId: actor.id,
        createdAt: "2024-01-02T04:30:00.000Z",
        updatedAt: "2024-01-02T04:30:00.000Z",
        raw: { id: "activity-comment-other-pr" },
      },
    ];

    for (const comment of comments) {
      await upsertComment(comment);
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

    expect(individual.trends.activityHeatmap).toEqual([
      { day: 2, hour: 9, count: 2 },
      { day: 2, hour: 10, count: 2 },
      { day: 2, hour: 12, count: 2 },
      { day: 2, hour: 13, count: 2 },
      { day: 3, hour: 14, count: 2 },
      { day: 4, hour: 11, count: 1 },
      { day: 5, hour: 10, count: 1 },
    ]);

    const filteredAnalytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      personId: actor.id,
      repositoryIds: [targetRepository.id],
    });

    const filteredIndividual = filteredAnalytics.individual;
    expect(filteredIndividual).not.toBeNull();
    if (!filteredIndividual) {
      throw new Error("filtered individual analytics missing");
    }

    expect(filteredIndividual.trends.activityHeatmap).toEqual([
      { day: 2, hour: 9, count: 2 },
      { day: 2, hour: 10, count: 2 },
      { day: 3, hour: 14, count: 2 },
    ]);
  });
});
