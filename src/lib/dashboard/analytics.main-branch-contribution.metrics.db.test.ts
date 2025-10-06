// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import type { LeaderboardEntry } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
  upsertUser,
} from "@/lib/db/operations";

const RANGE_START = "2024-04-01T00:00:00.000Z";
const RANGE_END = "2024-04-30T23:59:59.999Z";

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

function createMergedPullRequest({
  id,
  number,
  repository,
  authorId,
  mergedAt,
  additions,
  deletions,
}: {
  id: string;
  number: number;
  repository: DbRepository;
  authorId: string;
  mergedAt: string;
  additions: number;
  deletions: number;
}): DbPullRequest {
  const createdAt = new Date(
    new Date(mergedAt).getTime() - 3_600_000,
  ).toISOString();
  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title: `${repository.name} #${number}`,
    state: "MERGED",
    createdAt,
    updatedAt: mergedAt,
    closedAt: mergedAt,
    mergedAt,
    merged: true,
    raw: {
      author: { id: authorId },
      additions,
      deletions,
    },
  };
}

async function seedMainBranchScenario() {
  const repo: DbRepository = {
    id: "repo-main",
    name: "main",
    nameWithOwner: "octo/main",
    ownerId: "owner",
    raw: { id: "repo-main" },
  };

  const owner = buildActor("owner", "owner");
  const aria = buildActor("user-aria", "aria", "Aria");
  const bryce = buildActor("user-bryce", "bryce", "Bryce");
  const cam = buildActor("user-cam", "cam", "Cam");
  const drew = buildActor("user-drew", "drew", "Drew");
  const dependabot: DbActor = {
    id: "user-dependabot",
    login: "dependabot[bot]",
    name: "Dependabot",
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  };

  for (const actor of [owner, aria, bryce, cam, drew, dependabot]) {
    await upsertUser(actor);
  }

  await upsertRepository(repo);

  const pullRequests: DbPullRequest[] = [
    createMergedPullRequest({
      id: "repo-main-pr-alpha",
      number: 1,
      repository: repo,
      authorId: aria.id,
      mergedAt: "2024-04-05T12:00:00.000Z",
      additions: 100,
      deletions: 10,
    }),
    createMergedPullRequest({
      id: "repo-main-pr-beta",
      number: 2,
      repository: repo,
      authorId: bryce.id,
      mergedAt: "2024-04-10T12:00:00.000Z",
      additions: 80,
      deletions: 20,
    }),
    createMergedPullRequest({
      id: "repo-main-pr-gamma",
      number: 3,
      repository: repo,
      authorId: cam.id,
      mergedAt: "2024-04-17T12:00:00.000Z",
      additions: 40,
      deletions: 5,
    }),
    createMergedPullRequest({
      id: "repo-main-pr-delta",
      number: 4,
      repository: repo,
      authorId: drew.id,
      mergedAt: "2024-04-22T12:00:00.000Z",
      additions: 130,
      deletions: 50,
    }),
    createMergedPullRequest({
      id: "repo-main-pr-epsilon",
      number: 5,
      repository: repo,
      authorId: dependabot.id,
      mergedAt: "2024-04-15T12:00:00.000Z",
      additions: 200,
      deletions: 100,
    }),
    {
      ...createMergedPullRequest({
        id: "repo-main-pr-outside",
        number: 6,
        repository: repo,
        authorId: aria.id,
        mergedAt: "2024-03-10T12:00:00.000Z",
        additions: 75,
        deletions: 10,
      }),
      createdAt: "2024-03-09T12:00:00.000Z",
    },
  ];

  for (const pr of pullRequests) {
    await upsertPullRequest(pr);
  }

  const reviews: DbReview[] = [
    {
      id: "review-bryce-alpha",
      pullRequestId: "repo-main-pr-alpha",
      authorId: bryce.id,
      state: "CHANGES_REQUESTED",
      submittedAt: "2024-04-06T09:00:00.000Z",
      raw: {},
    },
    {
      id: "review-cam-alpha",
      pullRequestId: "repo-main-pr-alpha",
      authorId: cam.id,
      state: "APPROVED",
      submittedAt: "2024-04-06T09:05:00.000Z",
      raw: {},
    },
    {
      id: "review-drew-alpha",
      pullRequestId: "repo-main-pr-alpha",
      authorId: drew.id,
      state: "APPROVED",
      submittedAt: "2024-04-06T09:10:00.000Z",
      raw: {},
    },
    {
      id: "review-aria-beta",
      pullRequestId: "repo-main-pr-beta",
      authorId: aria.id,
      state: "APPROVED",
      submittedAt: "2024-04-11T08:00:00.000Z",
      raw: {},
    },
    {
      id: "review-cam-beta",
      pullRequestId: "repo-main-pr-beta",
      authorId: cam.id,
      state: "COMMENTED",
      submittedAt: "2024-04-11T08:05:00.000Z",
      raw: {},
    },
    {
      id: "review-drew-beta",
      pullRequestId: "repo-main-pr-beta",
      authorId: drew.id,
      state: "APPROVED",
      submittedAt: "2024-04-11T08:10:00.000Z",
      raw: {},
    },
    {
      id: "review-cam-beta-dismissed",
      pullRequestId: "repo-main-pr-beta",
      authorId: cam.id,
      state: "DISMISSED",
      submittedAt: "2024-04-11T08:15:00.000Z",
      raw: {},
    },
    {
      id: "review-bryce-gamma",
      pullRequestId: "repo-main-pr-gamma",
      authorId: bryce.id,
      state: "APPROVED",
      submittedAt: "2024-04-18T07:55:00.000Z",
      raw: {},
    },
    {
      id: "review-aria-delta",
      pullRequestId: "repo-main-pr-delta",
      authorId: aria.id,
      state: "CHANGES_REQUESTED",
      submittedAt: "2024-04-23T10:00:00.000Z",
      raw: {},
    },
    {
      id: "review-cam-delta",
      pullRequestId: "repo-main-pr-delta",
      authorId: cam.id,
      state: "APPROVED",
      submittedAt: "2024-04-23T10:05:00.000Z",
      raw: {},
    },
    {
      id: "review-drew-gamma",
      pullRequestId: "repo-main-pr-gamma",
      authorId: drew.id,
      state: "COMMENTED",
      submittedAt: "2024-04-18T08:05:00.000Z",
      raw: {},
    },
    {
      id: "review-drew-alpha-outside",
      pullRequestId: "repo-main-pr-outside",
      authorId: drew.id,
      state: "APPROVED",
      submittedAt: "2024-03-10T10:00:00.000Z",
      raw: {},
    },
    {
      id: "review-drew-epsilon",
      pullRequestId: "repo-main-pr-epsilon",
      authorId: drew.id,
      state: "APPROVED",
      submittedAt: "2024-04-15T09:30:00.000Z",
      raw: {},
    },
    {
      id: "review-aria-epsilon",
      pullRequestId: "repo-main-pr-epsilon",
      authorId: aria.id,
      state: "APPROVED",
      submittedAt: "2024-04-15T09:35:00.000Z",
      raw: {},
    },
  ];

  for (const review of reviews) {
    await upsertReview(review);
  }
}

function getDetail(entry: LeaderboardEntry, label: string) {
  const detail = entry.details?.find((item) => item.label === label);
  return Number(detail?.value ?? 0);
}

function requireEntry(map: Map<string, LeaderboardEntry>, id: string) {
  const entry = map.get(id);
  if (!entry) {
    throw new Error(`Missing leaderboard entry for ${id}`);
  }

  return entry;
}

function sortEntries(
  entries: LeaderboardEntry[],
  key: "count" | "additions" | "net",
) {
  const selectValue = (entry: LeaderboardEntry) => {
    if (key === "additions") {
      return getDetail(entry, "+");
    }

    if (key === "net") {
      return getDetail(entry, "+") - getDetail(entry, "-");
    }

    return entry.value;
  };

  const nameKey = (entry: LeaderboardEntry) =>
    entry.user.login ?? entry.user.name ?? entry.user.id;

  return [...entries].sort((a, b) => {
    const valueDiff = selectValue(b) - selectValue(a);
    if (valueDiff !== 0) {
      return valueDiff;
    }

    return nameKey(a).localeCompare(nameKey(b));
  });
}

describe("analytics main branch contribution leaderboards", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedMainBranchScenario();
  });

  it("aggregates main branch contribution metrics", async () => {
    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const entries = analytics.leaderboard.mainBranchContribution;
    const byUser = new Map(entries.map((entry) => [entry.user.id, entry]));

    expect(byUser.size).toBe(4);

    const aria = requireEntry(byUser, "user-aria");
    expect(aria.value).toBe(3);
    expect(aria.secondaryValue).toBe(2);
    expect(getDetail(aria, "PR")).toBe(1);
    expect(getDetail(aria, "+")).toBe(310);
    expect(getDetail(aria, "-")).toBe(80);

    const bryce = requireEntry(byUser, "user-bryce");
    expect(bryce.value).toBe(3);
    expect(bryce.secondaryValue).toBe(2);
    expect(getDetail(bryce, "PR")).toBe(1);
    expect(getDetail(bryce, "+")).toBe(220);
    expect(getDetail(bryce, "-")).toBe(35);

    const cam = requireEntry(byUser, "user-cam");
    expect(cam.value).toBe(4);
    expect(cam.secondaryValue).toBe(3);
    expect(getDetail(cam, "PR")).toBe(1);
    expect(getDetail(cam, "+")).toBe(350);
    expect(getDetail(cam, "-")).toBe(85);

    const drew = requireEntry(byUser, "user-drew");
    expect(drew.value).toBe(4);
    expect(drew.secondaryValue).toBe(3);
    expect(getDetail(drew, "PR")).toBe(1);
    expect(getDetail(drew, "+")).toBe(350);
    expect(getDetail(drew, "-")).toBe(85);
  });

  it("aggregates active main branch contribution metrics", async () => {
    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const entries = analytics.leaderboard.activeMainBranchContribution;
    const byUser = new Map(entries.map((entry) => [entry.user.id, entry]));

    expect(byUser.size).toBe(4);

    const aria = requireEntry(byUser, "user-aria");
    expect(aria.value).toBe(2);
    expect(aria.secondaryValue).toBe(1);
    expect(getDetail(aria, "PR")).toBe(1);
    expect(getDetail(aria, "+")).toBe(180);
    expect(getDetail(aria, "-")).toBe(30);

    const bryce = requireEntry(byUser, "user-bryce");
    expect(bryce.value).toBe(2);
    expect(bryce.secondaryValue).toBe(1);
    expect(getDetail(bryce, "PR")).toBe(1);
    expect(getDetail(bryce, "+")).toBe(120);
    expect(getDetail(bryce, "-")).toBe(25);

    const cam = requireEntry(byUser, "user-cam");
    expect(cam.value).toBe(3);
    expect(cam.secondaryValue).toBe(2);
    expect(getDetail(cam, "PR")).toBe(1);
    expect(getDetail(cam, "+")).toBe(270);
    expect(getDetail(cam, "-")).toBe(65);

    const drew = requireEntry(byUser, "user-drew");
    expect(drew.value).toBe(3);
    expect(drew.secondaryValue).toBe(2);
    expect(getDetail(drew, "PR")).toBe(1);
    expect(getDetail(drew, "+")).toBe(310);
    expect(getDetail(drew, "-")).toBe(80);
  });

  it("sorts main branch contribution entries like the leaderboard", async () => {
    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const entries = analytics.leaderboard.mainBranchContribution;

    expect(sortEntries(entries, "count").map((entry) => entry.user.id)).toEqual(
      ["user-cam", "user-drew", "user-aria", "user-bryce"],
    );

    expect(
      sortEntries(entries, "additions").map((entry) => entry.user.id),
    ).toEqual(["user-cam", "user-drew", "user-aria", "user-bryce"]);

    expect(sortEntries(entries, "net").map((entry) => entry.user.id)).toEqual([
      "user-cam",
      "user-drew",
      "user-aria",
      "user-bryce",
    ]);
  });

  it("sorts active main branch contribution entries like the leaderboard", async () => {
    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const entries = analytics.leaderboard.activeMainBranchContribution;

    expect(sortEntries(entries, "count").map((entry) => entry.user.id)).toEqual(
      ["user-cam", "user-drew", "user-aria", "user-bryce"],
    );

    expect(
      sortEntries(entries, "additions").map((entry) => entry.user.id),
    ).toEqual(["user-drew", "user-cam", "user-aria", "user-bryce"]);

    expect(sortEntries(entries, "net").map((entry) => entry.user.id)).toEqual([
      "user-drew",
      "user-cam",
      "user-aria",
      "user-bryce",
    ]);
  });
});
