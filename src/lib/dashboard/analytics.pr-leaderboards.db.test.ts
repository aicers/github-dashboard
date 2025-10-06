// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  upsertPullRequest,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const RANGE_START = "2024-07-01T00:00:00.000Z";
const RANGE_END = "2024-07-31T23:59:59.999Z";

function buildActor(id: string, login: string, name?: string): DbActor {
  return {
    id,
    login,
    name: name ?? login,
    createdAt: RANGE_START,
    updatedAt: RANGE_START,
  } satisfies DbActor;
}

function createPullRequest(params: {
  id: string;
  number: number;
  repository: DbRepository;
  authorId: string;
  createdAt: string;
  mergedAt?: string | null;
  mergedById?: string | null;
  additions?: number;
  deletions?: number;
}): DbPullRequest {
  const {
    id,
    number,
    repository,
    authorId,
    createdAt,
    mergedAt,
    mergedById,
    additions,
    deletions,
  } = params;
  const effectiveMergedAt = mergedAt ?? null;
  const state = effectiveMergedAt ? "MERGED" : "OPEN";
  const updatedAt = effectiveMergedAt ?? createdAt;

  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title: `${repository.name} #${number}`,
    state,
    createdAt,
    updatedAt,
    closedAt: effectiveMergedAt,
    mergedAt: effectiveMergedAt,
    merged: Boolean(effectiveMergedAt),
    raw: {
      id,
      author: { id: authorId },
      mergedAt: effectiveMergedAt,
      mergedBy: mergedById ? { id: mergedById } : null,
      additions,
      deletions,
    },
  } satisfies DbPullRequest;
}

function buildRepository(
  id: string,
  name: string,
  ownerId: string,
): DbRepository {
  return {
    id,
    name,
    nameWithOwner: `${ownerId}/${name}`,
    ownerId,
    raw: { id, name },
  } satisfies DbRepository;
}

describe("analytics PR leaderboards", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("builds PR creation leaderboard counts and filters by repository selection", async () => {
    const owner = buildActor("user-owner", "owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");

    for (const actor of [owner, alice, bob, carol]) {
      await upsertUser(actor);
    }

    const repoAlpha = buildRepository("repo-alpha", "alpha", owner.id);
    const repoBeta = buildRepository("repo-beta", "beta", owner.id);
    await upsertRepository(repoAlpha);
    await upsertRepository(repoBeta);

    const pullRequests: DbPullRequest[] = [
      createPullRequest({
        id: "alpha-pr-1",
        number: 1,
        repository: repoAlpha,
        authorId: alice.id,
        createdAt: "2024-07-03T10:00:00.000Z",
      }),
      createPullRequest({
        id: "alpha-pr-2",
        number: 2,
        repository: repoAlpha,
        authorId: alice.id,
        createdAt: "2024-07-10T11:00:00.000Z",
      }),
      createPullRequest({
        id: "alpha-pr-3",
        number: 3,
        repository: repoAlpha,
        authorId: bob.id,
        createdAt: "2024-07-11T09:00:00.000Z",
      }),
      createPullRequest({
        id: "beta-pr-1",
        number: 4,
        repository: repoBeta,
        authorId: alice.id,
        createdAt: "2024-07-12T08:00:00.000Z",
      }),
      createPullRequest({
        id: "beta-pr-2",
        number: 5,
        repository: repoBeta,
        authorId: bob.id,
        createdAt: "2024-07-15T13:00:00.000Z",
      }),
      createPullRequest({
        id: "beta-pr-3",
        number: 6,
        repository: repoBeta,
        authorId: carol.id,
        createdAt: "2024-07-20T14:00:00.000Z",
      }),
      createPullRequest({
        id: "alpha-pr-outside",
        number: 7,
        repository: repoAlpha,
        authorId: alice.id,
        createdAt: "2024-06-20T10:00:00.000Z",
      }),
    ];

    for (const pr of pullRequests) {
      await upsertPullRequest(pr);
    }

    const analyticsAll = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const creationEntries = analyticsAll.leaderboard.prsCreated;
    expect(
      creationEntries.map((entry) => [entry.user.id, entry.value]),
    ).toEqual([
      [alice.id, 3],
      [bob.id, 2],
      [carol.id, 1],
    ]);
    expect(creationEntries[0]?.user.name).toBe("Alice");

    const analyticsAlpha = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
      repositoryIds: [repoAlpha.id],
    });

    expect(
      analyticsAlpha.leaderboard.prsCreated.map((entry) => [
        entry.user.id,
        entry.value,
      ]),
    ).toEqual([
      [alice.id, 2],
      [bob.id, 1],
    ]);
    expect(
      analyticsAlpha.leaderboard.prsCreated.some(
        (entry) => entry.user.id === carol.id,
      ),
    ).toBe(false);
  });

  it("builds PR merge leaderboard with aggregated line change details", async () => {
    const owner = buildActor("user-owner", "owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const merger = buildActor("user-merger", "merger", "Mer Ger");

    for (const actor of [owner, alice, bob, merger]) {
      await upsertUser(actor);
    }

    const repo = buildRepository("repo-merge", "merge", owner.id);
    await upsertRepository(repo);

    const mergedPullRequests: DbPullRequest[] = [
      createPullRequest({
        id: "merge-pr-alice-1",
        number: 1,
        repository: repo,
        authorId: alice.id,
        createdAt: "2024-07-02T09:00:00.000Z",
        mergedAt: "2024-07-05T12:00:00.000Z",
        mergedById: merger.id,
        additions: 120,
        deletions: 50,
      }),
      createPullRequest({
        id: "merge-pr-alice-2",
        number: 2,
        repository: repo,
        authorId: alice.id,
        createdAt: "2024-07-08T09:30:00.000Z",
        mergedAt: "2024-07-11T12:00:00.000Z",
        mergedById: merger.id,
        additions: 80,
        deletions: 30,
      }),
      createPullRequest({
        id: "merge-pr-bob-1",
        number: 3,
        repository: repo,
        authorId: bob.id,
        createdAt: "2024-07-14T10:00:00.000Z",
        mergedAt: "2024-07-16T15:00:00.000Z",
        mergedById: merger.id,
        additions: 40,
        deletions: 10,
      }),
      createPullRequest({
        id: "merge-pr-open",
        number: 4,
        repository: repo,
        authorId: alice.id,
        createdAt: "2024-07-20T10:00:00.000Z",
      }),
      createPullRequest({
        id: "merge-pr-old",
        number: 5,
        repository: repo,
        authorId: alice.id,
        createdAt: "2024-06-10T09:00:00.000Z",
        mergedAt: "2024-06-12T09:00:00.000Z",
        mergedById: merger.id,
        additions: 60,
        deletions: 15,
      }),
    ];

    for (const pr of mergedPullRequests) {
      await upsertPullRequest(pr);
    }

    const analytics = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    const mergeEntries = analytics.leaderboard.prsMerged;
    expect(mergeEntries.map((entry) => [entry.user.id, entry.value])).toEqual([
      [alice.id, 2],
      [bob.id, 1],
    ]);

    const aliceEntry = mergeEntries.find((entry) => entry.user.id === alice.id);
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry?.secondaryValue).toBeNull();
    expect(aliceEntry?.details).toEqual([
      expect.objectContaining({
        label: "+",
        value: 200,
        sign: "positive",
        suffix: "라인",
      }),
      expect.objectContaining({
        label: "-",
        value: 80,
        sign: "negative",
        suffix: "라인",
      }),
    ]);

    const bobEntry = mergeEntries.find((entry) => entry.user.id === bob.id);
    expect(bobEntry?.details).toEqual([
      expect.objectContaining({ label: "+", value: 40 }),
      expect.objectContaining({ label: "-", value: 10 }),
    ]);

    expect(mergeEntries.some((entry) => entry.user.id === merger.id)).toBe(
      false,
    );

    const getAdditions = (entry: (typeof mergeEntries)[number]) =>
      entry.details?.find((detail) => detail.label === "+")?.value ?? 0;
    const getNet = (entry: (typeof mergeEntries)[number]) => {
      const additions = getAdditions(entry);
      const deletions =
        entry.details?.find((detail) => detail.label === "-")?.value ?? 0;
      return additions - deletions;
    };

    const sortedByCount = [...mergeEntries].sort((a, b) => b.value - a.value);
    expect(sortedByCount.map((entry) => entry.user.id)).toEqual([
      alice.id,
      bob.id,
    ]);

    const sortedByAdditions = [...mergeEntries].sort(
      (a, b) => getAdditions(b) - getAdditions(a),
    );
    expect(sortedByAdditions.map((entry) => entry.user.id)).toEqual([
      alice.id,
      bob.id,
    ]);

    const sortedByNet = [...mergeEntries].sort((a, b) => getNet(b) - getNet(a));
    expect(sortedByNet.map((entry) => entry.user.id)).toEqual([
      alice.id,
      bob.id,
    ]);
  });

  it("builds PR merged-by leaderboard from merger identities and removes dependabot activity", async () => {
    const owner = buildActor("user-owner", "owner");
    const author = buildActor("user-author", "author", "Author");
    const reviewer = buildActor("user-reviewer", "reviewer", "Reviewer");
    const mergerMel = buildActor("user-mel", "mel", "Mel");
    const mergerNina = buildActor("user-nina", "nina", "Nina");
    const dependabot = buildActor("user-bot", "dependabot[bot]", "Dependabot");

    for (const actor of [
      owner,
      author,
      reviewer,
      mergerMel,
      mergerNina,
      dependabot,
    ]) {
      await upsertUser(actor);
    }

    const repoAlpha = buildRepository("repo-alpha", "alpha", owner.id);
    const repoBeta = buildRepository("repo-beta", "beta", owner.id);
    await upsertRepository(repoAlpha);
    await upsertRepository(repoBeta);

    const prs: DbPullRequest[] = [
      createPullRequest({
        id: "alpha-pr-mel-1",
        number: 1,
        repository: repoAlpha,
        authorId: author.id,
        createdAt: "2024-07-03T08:30:00.000Z",
        mergedAt: "2024-07-05T09:00:00.000Z",
        mergedById: mergerMel.id,
      }),
      createPullRequest({
        id: "alpha-pr-mel-2",
        number: 2,
        repository: repoAlpha,
        authorId: reviewer.id,
        createdAt: "2024-07-07T08:30:00.000Z",
        mergedAt: "2024-07-09T09:00:00.000Z",
        mergedById: mergerMel.id,
      }),
      createPullRequest({
        id: "beta-pr-nina-1",
        number: 3,
        repository: repoBeta,
        authorId: reviewer.id,
        createdAt: "2024-07-10T10:00:00.000Z",
        mergedAt: "2024-07-11T11:00:00.000Z",
        mergedById: mergerNina.id,
      }),
      createPullRequest({
        id: "beta-pr-bot",
        number: 4,
        repository: repoBeta,
        authorId: author.id,
        createdAt: "2024-07-12T10:00:00.000Z",
        mergedAt: "2024-07-13T11:00:00.000Z",
        mergedById: dependabot.id,
      }),
      createPullRequest({
        id: "alpha-pr-old",
        number: 5,
        repository: repoAlpha,
        authorId: author.id,
        createdAt: "2024-06-01T10:00:00.000Z",
        mergedAt: "2024-06-02T11:00:00.000Z",
        mergedById: mergerMel.id,
      }),
    ];

    for (const pr of prs) {
      await upsertPullRequest(pr);
    }

    const analyticsAll = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
    });

    expect(
      analyticsAll.leaderboard.prsMergedBy.map((entry) => [
        entry.user.id,
        entry.value,
      ]),
    ).toEqual([
      [mergerMel.id, 2],
      [mergerNina.id, 1],
    ]);

    expect(
      analyticsAll.leaderboard.prsMergedBy.some(
        (entry) => entry.user.id === dependabot.id,
      ),
    ).toBe(false);

    const analyticsAlpha = await getDashboardAnalytics({
      start: RANGE_START,
      end: RANGE_END,
      repositoryIds: [repoAlpha.id],
    });

    expect(
      analyticsAlpha.leaderboard.prsMergedBy.map((entry) => [
        entry.user.id,
        entry.value,
      ]),
    ).toEqual([[mergerMel.id, 2]]);
  });
});
