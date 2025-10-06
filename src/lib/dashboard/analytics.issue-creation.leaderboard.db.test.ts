// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";

const RANGE_START = "2024-05-01T00:00:00.000Z";
const RANGE_END = "2024-05-31T23:59:59.999Z";

let issueNumber = 1;

async function resetDatabase() {
  await query(
    "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users RESTART IDENTITY CASCADE",
  );
}

function buildActor(id: string, login: string, name?: string): DbActor {
  return {
    id,
    login,
    name: name ?? login,
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  };
}

function createRepository(
  id: string,
  nameWithOwner: string,
  ownerId: string,
): DbRepository {
  const segments = nameWithOwner.split("/");
  const name = segments[segments.length - 1] ?? nameWithOwner;
  return {
    id,
    name,
    nameWithOwner,
    ownerId,
    raw: { id },
  };
}

function createIssue(params: {
  id: string;
  repository: DbRepository;
  authorId?: string | null;
  createdAt: string;
  closedAt?: string | null;
  state?: DbIssue["state"];
}): DbIssue {
  const { id, repository, authorId, createdAt, closedAt, state } = params;
  const resolvedClosedAt = closedAt ?? null;
  const resolvedState = state ?? (resolvedClosedAt ? "CLOSED" : "OPEN");
  const updatedAt = resolvedClosedAt ?? createdAt;

  return {
    id,
    number: issueNumber++,
    repositoryId: repository.id,
    authorId: authorId ?? null,
    title: id,
    state: resolvedState,
    createdAt,
    updatedAt,
    closedAt: resolvedClosedAt,
    raw: { id },
  };
}

describe("analytics issue creation leaderboard", () => {
  beforeEach(async () => {
    issueNumber = 1;
    await resetDatabase();
  });

  it("counts issues per author within the selected range", async () => {
    const owner = buildActor("user-owner", "owner");
    const aria = buildActor("user-aria", "aria", "Aria");
    const bryce = buildActor("user-bryce", "bryce", "Bryce");
    const cam = buildActor("user-cam", "cam", "Cam");

    for (const actor of [owner, aria, bryce, cam]) {
      await upsertUser(actor);
    }

    const repo = createRepository("repo-analytics", "octo/analytics", owner.id);
    await upsertRepository(repo);

    const issues: DbIssue[] = [
      createIssue({
        id: "issue-aria-1",
        repository: repo,
        authorId: aria.id,
        createdAt: "2024-05-03T10:00:00.000Z",
      }),
      createIssue({
        id: "issue-aria-2",
        repository: repo,
        authorId: aria.id,
        createdAt: "2024-05-06T14:30:00.000Z",
      }),
      createIssue({
        id: "issue-aria-3",
        repository: repo,
        authorId: aria.id,
        createdAt: "2024-05-28T08:15:00.000Z",
      }),
      createIssue({
        id: "issue-bryce-1",
        repository: repo,
        authorId: bryce.id,
        createdAt: "2024-05-07T09:45:00.000Z",
      }),
      createIssue({
        id: "issue-bryce-2",
        repository: repo,
        authorId: bryce.id,
        createdAt: "2024-05-18T20:00:00.000Z",
      }),
      createIssue({
        id: "issue-cam-1",
        repository: repo,
        authorId: cam.id,
        createdAt: "2024-05-11T12:00:00.000Z",
      }),
      createIssue({
        id: "issue-aria-outside",
        repository: repo,
        authorId: aria.id,
        createdAt: "2024-04-22T12:00:00.000Z",
      }),
      createIssue({
        id: "issue-anon",
        repository: repo,
        authorId: null,
        createdAt: "2024-05-15T16:45:00.000Z",
      }),
    ];

    for (const issue of issues) {
      await upsertIssue(issue);
    }

    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const entries = analytics.leaderboard.issuesCreated;
    expect(entries.map((entry) => entry.user.id)).toEqual([
      "user-aria",
      "user-bryce",
      "user-cam",
    ]);

    const byUser = new Map(entries.map((entry) => [entry.user.id, entry]));

    expect(byUser.get("user-aria")?.value).toBe(3);
    expect(byUser.get("user-bryce")?.value).toBe(2);
    expect(byUser.get("user-cam")?.value).toBe(1);
    expect(byUser.has("issue-anon")).toBe(false);
  });

  it("filters leaderboard counts by selected repositories", async () => {
    const owner = buildActor("user-owner", "owner");
    const aria = buildActor("user-aria", "aria", "Aria");
    const bryce = buildActor("user-bryce", "bryce", "Bryce");

    for (const actor of [owner, aria, bryce]) {
      await upsertUser(actor);
    }

    const repoAlpha = createRepository("repo-alpha", "octo/alpha", owner.id);
    const repoBeta = createRepository("repo-beta", "octo/beta", owner.id);

    await upsertRepository(repoAlpha);
    await upsertRepository(repoBeta);

    const issues: DbIssue[] = [
      createIssue({
        id: "issue-alpha-aria-1",
        repository: repoAlpha,
        authorId: aria.id,
        createdAt: "2024-05-02T09:00:00.000Z",
      }),
      createIssue({
        id: "issue-alpha-aria-2",
        repository: repoAlpha,
        authorId: aria.id,
        createdAt: "2024-05-12T10:30:00.000Z",
      }),
      createIssue({
        id: "issue-alpha-bryce-1",
        repository: repoAlpha,
        authorId: bryce.id,
        createdAt: "2024-05-15T11:45:00.000Z",
      }),
      createIssue({
        id: "issue-beta-aria-1",
        repository: repoBeta,
        authorId: aria.id,
        createdAt: "2024-05-08T08:15:00.000Z",
      }),
      createIssue({
        id: "issue-beta-bryce-1",
        repository: repoBeta,
        authorId: bryce.id,
        createdAt: "2024-05-19T20:00:00.000Z",
      }),
      createIssue({
        id: "issue-beta-bryce-2",
        repository: repoBeta,
        authorId: bryce.id,
        createdAt: "2024-05-22T21:30:00.000Z",
      }),
    ];

    for (const issue of issues) {
      await upsertIssue(issue);
    }

    const analyticsAlpha = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
      repositoryIds: [repoAlpha.id],
    });
    const alphaEntries = analyticsAlpha.leaderboard.issuesCreated;
    expect(alphaEntries.map((entry) => entry.user.id)).toEqual([
      "user-aria",
      "user-bryce",
    ]);

    const alphaByUser = new Map(
      alphaEntries.map((entry) => [entry.user.id, entry]),
    );
    expect(alphaByUser.get("user-aria")?.value).toBe(2);
    expect(alphaByUser.get("user-bryce")?.value).toBe(1);

    const analyticsBeta = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
      repositoryIds: [repoBeta.id],
    });
    const betaEntries = analyticsBeta.leaderboard.issuesCreated;
    expect(betaEntries.map((entry) => entry.user.id)).toEqual([
      "user-bryce",
      "user-aria",
    ]);

    const betaByUser = new Map(
      betaEntries.map((entry) => [entry.user.id, entry]),
    );
    expect(betaByUser.get("user-bryce")?.value).toBe(2);
    expect(betaByUser.get("user-aria")?.value).toBe(1);
  });
});
