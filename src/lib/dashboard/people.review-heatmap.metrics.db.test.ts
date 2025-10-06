// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  updateSyncConfig,
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

describe("people review heatmap", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("aggregates review buckets for an individual respecting timezone, filters, and repository selection", async () => {
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [],
      excludedUsers: [],
    });

    const { actor, repository: targetRepository } = await seedPersonAndRepo();

    const otherRepository: DbRepository = {
      id: "person-other-repo",
      name: "person-other-repo",
      nameWithOwner: "octo/person-other-repo",
      ownerId: actor.id,
      raw: { id: "person-other-repo" },
    };
    await upsertRepository(otherRepository);

    const prAuthor: DbActor = {
      id: "person-pr-author",
      login: "person-pr-author",
      name: "PR Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const otherAuthor: DbActor = {
      id: "person-other-author",
      login: "person-other-author",
      name: "Other Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabotAuthor: DbActor = {
      id: "dependabot-user",
      login: "dependabot[bot]",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };

    await Promise.all([
      upsertUser(prAuthor),
      upsertUser(otherAuthor),
      upsertUser(dependabotAuthor),
    ]);

    const pullRequests: DbPullRequest[] = [
      {
        id: "target-review-pr-1",
        number: 101,
        repositoryId: targetRepository.id,
        authorId: prAuthor.id,
        title: "Target Review PR 1",
        state: "OPEN",
        createdAt: "2024-01-01T08:00:00.000Z",
        updatedAt: "2024-01-01T08:00:00.000Z",
        raw: { id: "target-review-pr-1" },
      },
      {
        id: "target-review-pr-2",
        number: 102,
        repositoryId: targetRepository.id,
        authorId: prAuthor.id,
        title: "Target Review PR 2",
        state: "OPEN",
        createdAt: "2024-01-01T09:00:00.000Z",
        updatedAt: "2024-01-01T09:00:00.000Z",
        raw: { id: "target-review-pr-2" },
      },
      {
        id: "other-review-pr-1",
        number: 201,
        repositoryId: otherRepository.id,
        authorId: otherAuthor.id,
        title: "Other Review PR",
        state: "OPEN",
        createdAt: "2024-01-01T10:00:00.000Z",
        updatedAt: "2024-01-01T10:00:00.000Z",
        raw: { id: "other-review-pr-1" },
      },
      {
        id: "dependabot-review-pr",
        number: 301,
        repositoryId: targetRepository.id,
        authorId: dependabotAuthor.id,
        title: "Dependabot PR",
        state: "OPEN",
        createdAt: "2024-01-01T11:00:00.000Z",
        updatedAt: "2024-01-01T11:00:00.000Z",
        raw: { id: "dependabot-review-pr" },
      },
      {
        id: "self-review-pr",
        number: 302,
        repositoryId: targetRepository.id,
        authorId: actor.id,
        title: "Self Authored PR",
        state: "OPEN",
        createdAt: "2024-01-01T12:00:00.000Z",
        updatedAt: "2024-01-01T12:00:00.000Z",
        raw: { id: "self-review-pr" },
      },
      {
        id: "dismissed-review-pr",
        number: 303,
        repositoryId: targetRepository.id,
        authorId: prAuthor.id,
        title: "Dismissed Review PR",
        state: "OPEN",
        createdAt: "2024-01-01T13:00:00.000Z",
        updatedAt: "2024-01-01T13:00:00.000Z",
        raw: { id: "dismissed-review-pr" },
      },
    ];

    for (const pullRequest of pullRequests) {
      await upsertPullRequest(pullRequest);
    }

    const reviews: DbReview[] = [
      {
        id: "review-target-1",
        pullRequestId: "target-review-pr-1",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: "2024-01-02T00:10:00.000Z",
        raw: { id: "review-target-1" },
      },
      {
        id: "review-target-2",
        pullRequestId: "target-review-pr-2",
        authorId: actor.id,
        state: "COMMENTED",
        submittedAt: "2024-01-02T00:40:00.000Z",
        raw: { id: "review-target-2" },
      },
      {
        id: "review-other-1",
        pullRequestId: "other-review-pr-1",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: "2024-01-03T05:15:00.000Z",
        raw: { id: "review-other-1" },
      },
      {
        id: "review-dependabot",
        pullRequestId: "dependabot-review-pr",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: "2024-01-05T02:00:00.000Z",
        raw: { id: "review-dependabot" },
      },
      {
        id: "review-self",
        pullRequestId: "self-review-pr",
        authorId: actor.id,
        state: "APPROVED",
        submittedAt: "2024-01-05T03:00:00.000Z",
        raw: { id: "review-self" },
      },
      {
        id: "review-dismissed",
        pullRequestId: "dismissed-review-pr",
        authorId: actor.id,
        state: "DISMISSED",
        submittedAt: "2024-01-05T04:00:00.000Z",
        raw: { id: "review-dismissed" },
      },
    ];

    for (const review of reviews) {
      await upsertReview(review);
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

    expect(individual.trends.reviewHeatmap).toEqual([
      { day: 2, hour: 9, count: 2 },
      { day: 3, hour: 14, count: 1 },
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

    expect(filteredIndividual.trends.reviewHeatmap).toEqual([
      { day: 2, hour: 9, count: 2 },
    ]);
  });
});
