// @vitest-environment jsdom
// Vitest defaults DB config to Node environment; keep this so React Testing Library has a DOM.

import "../../../tests/helpers/postgres-container";
import "@testing-library/jest-dom";

import { render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MetricCard } from "@/components/dashboard/metric-card";
import { toCardHistory } from "@/components/dashboard/metric-history";
import { formatNumber } from "@/components/dashboard/metric-utils";
import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  upsertPullRequest,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";

vi.mock("recharts", () => {
  const { createElement: createReactElement } =
    require("react") as typeof import("react");

  const createStub =
    (testId: string) =>
    ({ children }: { children?: import("react").ReactNode }) =>
      createReactElement("div", { "data-testid": testId }, children ?? null);

  return {
    ResponsiveContainer: createStub("recharts-responsive"),
    LineChart: createStub("recharts-line-chart"),
    Line: createStub("recharts-line"),
    XAxis: createStub("recharts-x-axis"),
    YAxis: createStub("recharts-y-axis"),
  };
});

const CURRENT_RANGE_START = "2024-01-01T00:00:00.000Z";
const CURRENT_RANGE_END = "2024-01-07T23:59:59.999Z";

function hoursBefore(iso: string, hours: number) {
  const base = new Date(iso).getTime();
  return new Date(base - hours * 3_600_000).toISOString();
}

async function insertPullRequest(pullRequest: DbPullRequest) {
  await upsertPullRequest(pullRequest);
}

describe("analytics pull request metrics", () => {
  beforeEach(async () => {
    await query(
      "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users RESTART IDENTITY CASCADE",
    );
  });

  it("builds pull request creation metrics with five-period history", async () => {
    const author: DbActor = {
      id: "pr-author",
      login: "octocommitter",
      name: "Octo Committer",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabot: DbActor = {
      id: "dependabot",
      login: "dependabot[bot]",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "repo-pr-creation",
      name: "pr-creation-repo",
      nameWithOwner: "octo/pr-creation-repo",
      ownerId: author.id,
      raw: { id: "repo-pr-creation" },
    };
    await upsertRepository(repository);

    let pullNumber = 1;
    const makePullRequest = ({
      id,
      createdAt,
      authorId = author.id,
    }: {
      id: string;
      createdAt: string;
      authorId?: string;
    }): DbPullRequest => ({
      id,
      number: pullNumber++,
      repositoryId: repository.id,
      authorId,
      title: id,
      state: "OPEN",
      createdAt,
      updatedAt: createdAt,
      closedAt: null,
      mergedAt: null,
      merged: false,
      raw: {
        author: { id: authorId },
        comments: { totalCount: 0 },
        additions: 0,
        deletions: 0,
      },
    });

    const creationGroups = {
      previous4: [
        "2023-12-04T09:00:00.000Z",
        "2023-12-05T11:15:00.000Z",
        "2023-12-06T14:45:00.000Z",
      ],
      previous3: ["2023-12-11T13:00:00.000Z"],
      previous2: ["2023-12-18T08:30:00.000Z", "2023-12-19T16:45:00.000Z"],
      previous: ["2023-12-26T09:00:00.000Z", "2023-12-28T15:30:00.000Z"],
      current: [
        "2024-01-02T10:00:00.000Z",
        "2024-01-04T14:30:00.000Z",
        "2024-01-06T18:45:00.000Z",
      ],
    } as const;

    const dependabotCreation = {
      previous: ["2023-12-27T07:00:00.000Z"],
      current: ["2024-01-03T09:30:00.000Z"],
    } as const;

    const pullRequests: DbPullRequest[] = [];
    (
      Object.entries(creationGroups) as Array<
        [keyof typeof creationGroups, readonly string[]]
      >
    ).forEach(([period, timestamps]) => {
      timestamps.forEach((timestamp, index) => {
        pullRequests.push(
          makePullRequest({
            id: `pr-${period}-${index + 1}`,
            createdAt: timestamp,
          }),
        );
      });
    });

    dependabotCreation.previous.forEach((createdAt, index) => {
      pullRequests.push(
        makePullRequest({
          id: `dependabot-previous-${index + 1}`,
          createdAt,
          authorId: dependabot.id,
        }),
      );
    });
    dependabotCreation.current.forEach((createdAt, index) => {
      pullRequests.push(
        makePullRequest({
          id: `dependabot-current-${index + 1}`,
          createdAt,
          authorId: dependabot.id,
        }),
      );
    });

    pullRequests.push(
      makePullRequest({
        id: "pr-created-outside",
        createdAt: "2023-11-01T12:00:00.000Z",
      }),
    );

    for (const pr of pullRequests) {
      await insertPullRequest(pr);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const prsCreated = analytics.organization.metrics.prsCreated;
    const expectedHistory = {
      previous4: creationGroups.previous4.length,
      previous3: creationGroups.previous3.length,
      previous2: creationGroups.previous2.length,
      previous: creationGroups.previous.length,
      current: creationGroups.current.length,
    } as const;

    const expectedAbsoluteChange =
      expectedHistory.current - expectedHistory.previous;
    const expectedPercentChange =
      (expectedAbsoluteChange / expectedHistory.previous) * 100;

    expect(prsCreated.current).toBe(expectedHistory.current);
    expect(prsCreated.previous).toBe(expectedHistory.previous);
    expect(prsCreated.absoluteChange).toBe(expectedAbsoluteChange);
    expect(prsCreated.percentChange).not.toBeNull();
    expect(prsCreated.percentChange ?? 0).toBeCloseTo(expectedPercentChange, 5);
    expect(prsCreated.breakdown).toEqual([
      {
        label: "Dependabot",
        current: dependabotCreation.current.length,
        previous: dependabotCreation.previous.length,
      },
    ]);

    const history = analytics.organization.metricHistory.prsCreated;
    expect(history).toEqual([
      { period: "previous4", value: expectedHistory.previous4 },
      { period: "previous3", value: expectedHistory.previous3 },
      { period: "previous2", value: expectedHistory.previous2 },
      { period: "previous", value: expectedHistory.previous },
      { period: "current", value: expectedHistory.current },
    ]);

    const metricTitle = "PR 생성";
    render(
      createElement(MetricCard, {
        title: metricTitle,
        metric: prsCreated,
        format: "count",
        history: toCardHistory(history),
      }),
    );

    expect(screen.getByText(metricTitle)).toBeInTheDocument();
    const card = screen.getByText(metricTitle).closest('[data-slot="card"]');
    if (!card) {
      throw new Error("pull request creation metric card not found");
    }

    expect(
      within(card as HTMLElement).getByText(
        formatNumber(expectedHistory.current),
      ),
    ).toBeInTheDocument();

    const percent = prsCreated.percentChange;
    const percentLabel =
      percent == null
        ? "–"
        : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
    const changeLabel = `${
      expectedAbsoluteChange >= 0 ? "+" : ""
    }${formatNumber(expectedAbsoluteChange)} (${percentLabel})`;
    expect(
      within(card as HTMLElement).getByText(changeLabel),
    ).toBeInTheDocument();
  });

  it("builds pull request merge metrics with five-period history", async () => {
    const author: DbActor = {
      id: "pr-merger",
      login: "octomerger",
      name: "Octo Merger",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabot: DbActor = {
      id: "dependabot-merger",
      login: "dependabot-update",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "repo-pr-merge",
      name: "pr-merge-repo",
      nameWithOwner: "octo/pr-merge-repo",
      ownerId: author.id,
      raw: { id: "repo-pr-merge" },
    };
    await upsertRepository(repository);

    let pullNumber = 100;
    const makeMergedPullRequest = ({
      id,
      mergedAt,
      authorId = author.id,
      createdOffsetHours = 24 * 60,
    }: {
      id: string;
      mergedAt: string;
      authorId?: string;
      createdOffsetHours?: number;
    }): DbPullRequest => {
      const createdAt = hoursBefore(mergedAt, createdOffsetHours);
      return {
        id,
        number: pullNumber++,
        repositoryId: repository.id,
        authorId,
        title: id,
        state: "MERGED",
        createdAt,
        updatedAt: mergedAt,
        closedAt: mergedAt,
        mergedAt,
        merged: true,
        raw: {
          author: { id: authorId },
          mergedBy: { id: authorId },
          comments: { totalCount: 0 },
          additions: 10,
          deletions: 2,
        },
      };
    };

    const mergeGroups = {
      previous4: ["2023-12-05T12:00:00.000Z", "2023-12-07T18:30:00.000Z"],
      previous3: ["2023-12-12T10:45:00.000Z"],
      previous2: ["2023-12-19T09:15:00.000Z", "2023-12-20T16:45:00.000Z"],
      previous: [
        "2023-12-27T11:00:00.000Z",
        "2023-12-29T19:30:00.000Z",
        "2023-12-30T22:15:00.000Z",
      ],
      current: [
        "2024-01-02T08:00:00.000Z",
        "2024-01-04T15:30:00.000Z",
        "2024-01-06T20:45:00.000Z",
        "2024-01-07T23:00:00.000Z",
      ],
    } as const;

    const dependabotMerges = {
      previous: ["2023-12-28T07:00:00.000Z"],
      current: ["2024-01-05T06:15:00.000Z"],
    } as const;

    const pullRequests: DbPullRequest[] = [];
    (
      Object.entries(mergeGroups) as Array<
        [keyof typeof mergeGroups, readonly string[]]
      >
    ).forEach(([period, timestamps]) => {
      timestamps.forEach((mergedAt, index) => {
        pullRequests.push(
          makeMergedPullRequest({
            id: `merged-${period}-${index + 1}`,
            mergedAt,
          }),
        );
      });
    });

    dependabotMerges.previous.forEach((mergedAt, index) => {
      pullRequests.push(
        makeMergedPullRequest({
          id: `dependabot-merged-previous-${index + 1}`,
          mergedAt,
          authorId: dependabot.id,
        }),
      );
    });
    dependabotMerges.current.forEach((mergedAt, index) => {
      pullRequests.push(
        makeMergedPullRequest({
          id: `dependabot-merged-current-${index + 1}`,
          mergedAt,
          authorId: dependabot.id,
        }),
      );
    });

    pullRequests.push(
      makeMergedPullRequest({
        id: "merged-outside",
        mergedAt: "2023-11-15T12:00:00.000Z",
      }),
    );

    for (const pr of pullRequests) {
      await insertPullRequest(pr);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const prsMerged = analytics.organization.metrics.prsMerged;
    const expectedHistory = {
      previous4: mergeGroups.previous4.length,
      previous3: mergeGroups.previous3.length,
      previous2: mergeGroups.previous2.length,
      previous: mergeGroups.previous.length,
      current: mergeGroups.current.length,
    } as const;

    const expectedAbsoluteChange =
      expectedHistory.current - expectedHistory.previous;
    const expectedPercentChange =
      (expectedAbsoluteChange / expectedHistory.previous) * 100;

    expect(prsMerged.current).toBe(expectedHistory.current);
    expect(prsMerged.previous).toBe(expectedHistory.previous);
    expect(prsMerged.absoluteChange).toBe(expectedAbsoluteChange);
    expect(prsMerged.percentChange).not.toBeNull();
    expect(prsMerged.percentChange ?? 0).toBeCloseTo(expectedPercentChange, 5);
    expect(prsMerged.breakdown).toEqual([
      {
        label: "Dependabot",
        current: dependabotMerges.current.length,
        previous: dependabotMerges.previous.length,
      },
    ]);

    const history = analytics.organization.metricHistory.prsMerged;
    expect(history).toEqual([
      { period: "previous4", value: expectedHistory.previous4 },
      { period: "previous3", value: expectedHistory.previous3 },
      { period: "previous2", value: expectedHistory.previous2 },
      { period: "previous", value: expectedHistory.previous },
      { period: "current", value: expectedHistory.current },
    ]);

    const metricTitle = "PR 머지";
    render(
      createElement(MetricCard, {
        title: metricTitle,
        metric: prsMerged,
        format: "count",
        history: toCardHistory(history),
      }),
    );

    expect(screen.getByText(metricTitle)).toBeInTheDocument();
    const card = screen.getByText(metricTitle).closest('[data-slot="card"]');
    if (!card) {
      throw new Error("pull request merge metric card not found");
    }

    expect(
      within(card as HTMLElement).getByText(
        formatNumber(expectedHistory.current),
      ),
    ).toBeInTheDocument();

    const percent = prsMerged.percentChange;
    const percentLabel =
      percent == null
        ? "–"
        : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
    const changeLabel = `${
      expectedAbsoluteChange >= 0 ? "+" : ""
    }${formatNumber(expectedAbsoluteChange)} (${percentLabel})`;
    expect(
      within(card as HTMLElement).getByText(changeLabel),
    ).toBeInTheDocument();
  });

  it("handles decreasing pull request creation and merge counts", async () => {
    const author: DbActor = {
      id: "pr-decrease-author",
      login: "octodecrease",
      name: "Octo Decrease",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);

    const repository: DbRepository = {
      id: "repo-pr-decrease",
      name: "pr-decrease-repo",
      nameWithOwner: "octo/pr-decrease-repo",
      ownerId: author.id,
      raw: { id: "repo-pr-decrease" },
    };
    await upsertRepository(repository);

    let pullNumber = 200;
    const makePullRequest = ({
      id,
      createdAt,
      mergedAt = null,
    }: {
      id: string;
      createdAt: string;
      mergedAt?: string | null;
    }): DbPullRequest => ({
      id,
      number: pullNumber++,
      repositoryId: repository.id,
      authorId: author.id,
      title: id,
      state: mergedAt ? "MERGED" : "OPEN",
      createdAt,
      updatedAt: mergedAt ?? createdAt,
      closedAt: mergedAt,
      mergedAt,
      merged: Boolean(mergedAt),
      raw: {
        author: { id: author.id },
        mergedBy: { id: author.id },
        comments: { totalCount: 0 },
        additions: 1,
        deletions: 1,
      },
    });

    const previousCreationTimes = [
      "2023-12-27T09:00:00.000Z",
      "2023-12-28T11:30:00.000Z",
      "2023-12-30T16:45:00.000Z",
    ];
    const currentCreationTimes = ["2024-01-05T14:00:00.000Z"];

    const previousMergeTimes = [
      "2023-12-27T18:00:00.000Z",
      "2023-12-29T21:15:00.000Z",
    ];
    const currentMergeTimes = ["2024-01-03T10:30:00.000Z"];

    for (let index = 0; index < previousCreationTimes.length; index += 1) {
      await insertPullRequest(
        makePullRequest({
          id: `decrease-created-previous-${index + 1}`,
          createdAt: previousCreationTimes[index],
        }),
      );
    }

    for (let index = 0; index < currentCreationTimes.length; index += 1) {
      await insertPullRequest(
        makePullRequest({
          id: `decrease-created-current-${index + 1}`,
          createdAt: currentCreationTimes[index],
        }),
      );
    }

    for (let index = 0; index < previousMergeTimes.length; index += 1) {
      const mergedAt = previousMergeTimes[index];
      await insertPullRequest(
        makePullRequest({
          id: `decrease-merged-previous-${index + 1}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    for (let index = 0; index < currentMergeTimes.length; index += 1) {
      const mergedAt = currentMergeTimes[index];
      await insertPullRequest(
        makePullRequest({
          id: `decrease-merged-current-${index + 1}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const prsCreated = analytics.organization.metrics.prsCreated;
    const prsMerged = analytics.organization.metrics.prsMerged;

    expect(prsCreated.current).toBe(currentCreationTimes.length);
    expect(prsCreated.previous).toBe(previousCreationTimes.length);
    expect(prsCreated.absoluteChange).toBe(
      currentCreationTimes.length - previousCreationTimes.length,
    );
    expect(prsCreated.percentChange).not.toBeNull();

    expect(prsMerged.current).toBe(currentMergeTimes.length);
    expect(prsMerged.previous).toBe(previousMergeTimes.length);
    expect(prsMerged.absoluteChange).toBe(
      currentMergeTimes.length - previousMergeTimes.length,
    );
    expect(prsMerged.percentChange).not.toBeNull();

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 생성",
          metric: prsCreated,
          format: "count",
          history: toCardHistory(
            analytics.organization.metricHistory.prsCreated,
          ),
        }),
        createElement(MetricCard, {
          title: "PR 머지",
          metric: prsMerged,
          format: "count",
          history: toCardHistory(
            analytics.organization.metricHistory.prsMerged,
          ),
        }),
      ),
    );

    const creationCard = screen
      .getByText("PR 생성")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const mergeCard = screen
      .getByText("PR 머지")
      .closest('[data-slot="card"]') as HTMLElement | null;

    if (!creationCard || !mergeCard) {
      throw new Error("decreasing metric cards not found");
    }

    const creationPercent = prsCreated.percentChange;
    const creationPercentLabel =
      creationPercent == null
        ? "–"
        : `${creationPercent >= 0 ? "+" : ""}${creationPercent.toFixed(1)}%`;
    const creationChangeLabel = `${
      prsCreated.absoluteChange >= 0 ? "+" : ""
    }${formatNumber(prsCreated.absoluteChange)} (${creationPercentLabel})`;
    expect(
      within(creationCard).getByText(creationChangeLabel),
    ).toBeInTheDocument();

    const mergePercent = prsMerged.percentChange;
    const mergePercentLabel =
      mergePercent == null
        ? "–"
        : `${mergePercent >= 0 ? "+" : ""}${mergePercent.toFixed(1)}%`;
    const mergeChangeLabel = `${
      prsMerged.absoluteChange >= 0 ? "+" : ""
    }${formatNumber(prsMerged.absoluteChange)} (${mergePercentLabel})`;
    expect(within(mergeCard).getByText(mergeChangeLabel)).toBeInTheDocument();
  });

  it("treats zero baseline counts as having no percent change", async () => {
    const author: DbActor = {
      id: "pr-zero-author",
      login: "octozero",
      name: "Octo Zero",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);

    const repository: DbRepository = {
      id: "repo-pr-zero",
      name: "pr-zero-repo",
      nameWithOwner: "octo/pr-zero-repo",
      ownerId: author.id,
      raw: { id: "repo-pr-zero" },
    };
    await upsertRepository(repository);

    let pullNumber = 300;
    const makePullRequest = ({
      id,
      createdAt,
      mergedAt = null,
    }: {
      id: string;
      createdAt: string;
      mergedAt?: string | null;
    }): DbPullRequest => ({
      id,
      number: pullNumber++,
      repositoryId: repository.id,
      authorId: author.id,
      title: id,
      state: mergedAt ? "MERGED" : "OPEN",
      createdAt,
      updatedAt: mergedAt ?? createdAt,
      closedAt: mergedAt,
      mergedAt,
      merged: Boolean(mergedAt),
      raw: {
        author: { id: author.id },
        mergedBy: { id: author.id },
        comments: { totalCount: 0 },
        additions: 5,
        deletions: 1,
      },
    });

    const currentCreationTimes = [
      "2024-01-02T09:00:00.000Z",
      "2024-01-04T13:30:00.000Z",
    ];
    const currentMergeTimes = [
      "2024-01-03T11:00:00.000Z",
      "2024-01-05T16:45:00.000Z",
    ];

    for (let index = 0; index < currentCreationTimes.length; index += 1) {
      await insertPullRequest(
        makePullRequest({
          id: `zero-created-${index + 1}`,
          createdAt: currentCreationTimes[index],
        }),
      );
    }

    for (let index = 0; index < currentMergeTimes.length; index += 1) {
      const mergedAt = currentMergeTimes[index];
      await insertPullRequest(
        makePullRequest({
          id: `zero-merged-${index + 1}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const prsCreated = analytics.organization.metrics.prsCreated;
    const prsMerged = analytics.organization.metrics.prsMerged;

    expect(prsCreated.previous).toBe(0);
    expect(prsCreated.current).toBe(currentCreationTimes.length);
    expect(prsCreated.absoluteChange).toBe(currentCreationTimes.length);
    expect(prsCreated.percentChange).toBeNull();

    expect(prsMerged.previous).toBe(0);
    expect(prsMerged.current).toBe(currentMergeTimes.length);
    expect(prsMerged.absoluteChange).toBe(currentMergeTimes.length);
    expect(prsMerged.percentChange).toBeNull();

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 생성",
          metric: prsCreated,
          format: "count",
          history: toCardHistory(
            analytics.organization.metricHistory.prsCreated,
          ),
        }),
        createElement(MetricCard, {
          title: "PR 머지",
          metric: prsMerged,
          format: "count",
          history: toCardHistory(
            analytics.organization.metricHistory.prsMerged,
          ),
        }),
      ),
    );

    const creationCard = screen
      .getByText("PR 생성")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const mergeCard = screen
      .getByText("PR 머지")
      .closest('[data-slot="card"]') as HTMLElement | null;

    if (!creationCard || !mergeCard) {
      throw new Error("zero baseline metric cards not found");
    }

    const creationChangeLabel = `${
      prsCreated.absoluteChange >= 0 ? "+" : ""
    }${formatNumber(prsCreated.absoluteChange)} (–)`;
    expect(
      within(creationCard).getByText(creationChangeLabel),
    ).toBeInTheDocument();

    const mergeChangeLabel = `${
      prsMerged.absoluteChange >= 0 ? "+" : ""
    }${formatNumber(prsMerged.absoluteChange)} (–)`;
    expect(within(mergeCard).getByText(mergeChangeLabel)).toBeInTheDocument();
  });

  it("excludes other repositories when a filter is provided", async () => {
    const author: DbActor = {
      id: "pr-filter-author",
      login: "octofilter",
      name: "Octo Filter",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(author);

    const primaryRepository: DbRepository = {
      id: "repo-pr-filter-primary",
      name: "pr-filter-primary",
      nameWithOwner: "octo/pr-filter-primary",
      ownerId: author.id,
      raw: { id: "repo-pr-filter-primary" },
    };
    const secondaryRepository: DbRepository = {
      id: "repo-pr-filter-secondary",
      name: "pr-filter-secondary",
      nameWithOwner: "octo/pr-filter-secondary",
      ownerId: author.id,
      raw: { id: "repo-pr-filter-secondary" },
    };
    await upsertRepository(primaryRepository);
    await upsertRepository(secondaryRepository);

    const makePullRequestFactory = (
      repository: DbRepository,
      startNumber: number,
    ) => {
      let localNumber = startNumber;
      return ({
        id,
        createdAt,
        mergedAt = null,
      }: {
        id: string;
        createdAt: string;
        mergedAt?: string | null;
      }): DbPullRequest => ({
        id,
        number: localNumber++,
        repositoryId: repository.id,
        authorId: author.id,
        title: id,
        state: mergedAt ? "MERGED" : "OPEN",
        createdAt,
        updatedAt: mergedAt ?? createdAt,
        closedAt: mergedAt,
        mergedAt,
        merged: Boolean(mergedAt),
        raw: {
          author: { id: author.id },
          mergedBy: { id: author.id },
          comments: { totalCount: 0 },
          additions: 3,
          deletions: 1,
        },
      });
    };

    const makePrimaryPr = makePullRequestFactory(primaryRepository, 400);
    const makeSecondaryPr = makePullRequestFactory(secondaryRepository, 500);

    const primaryCreation = {
      previous: ["2023-12-28T10:00:00.000Z"],
      current: ["2024-01-03T09:00:00.000Z", "2024-01-06T15:30:00.000Z"],
    } as const;
    const secondaryCreation = {
      previous: ["2023-12-27T12:00:00.000Z", "2023-12-29T18:45:00.000Z"],
      current: ["2024-01-05T11:15:00.000Z"],
    } as const;

    const primaryMerges = {
      previous: ["2023-12-28T20:00:00.000Z"],
      current: ["2024-01-04T17:00:00.000Z"],
    } as const;
    const secondaryMerges = {
      previous: ["2023-12-30T13:30:00.000Z"],
      current: ["2024-01-06T21:45:00.000Z"],
    } as const;

    for (const createdAt of primaryCreation.previous) {
      await insertPullRequest(
        makePrimaryPr({
          id: `primary-created-previous-${createdAt}`,
          createdAt,
        }),
      );
    }

    for (const createdAt of primaryCreation.current) {
      await insertPullRequest(
        makePrimaryPr({
          id: `primary-created-current-${createdAt}`,
          createdAt,
        }),
      );
    }

    for (const createdAt of secondaryCreation.previous) {
      await insertPullRequest(
        makeSecondaryPr({
          id: `secondary-created-previous-${createdAt}`,
          createdAt,
        }),
      );
    }

    for (const createdAt of secondaryCreation.current) {
      await insertPullRequest(
        makeSecondaryPr({
          id: `secondary-created-current-${createdAt}`,
          createdAt,
        }),
      );
    }

    for (const mergedAt of primaryMerges.previous) {
      await insertPullRequest(
        makePrimaryPr({
          id: `primary-merged-previous-${mergedAt}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    for (const mergedAt of primaryMerges.current) {
      await insertPullRequest(
        makePrimaryPr({
          id: `primary-merged-current-${mergedAt}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    for (const mergedAt of secondaryMerges.previous) {
      await insertPullRequest(
        makeSecondaryPr({
          id: `secondary-merged-previous-${mergedAt}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    for (const mergedAt of secondaryMerges.current) {
      await insertPullRequest(
        makeSecondaryPr({
          id: `secondary-merged-current-${mergedAt}`,
          createdAt: hoursBefore(mergedAt, 24 * 60),
          mergedAt,
        }),
      );
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      repositoryIds: [primaryRepository.id],
    });

    const prsCreated = analytics.organization.metrics.prsCreated;
    const prsMerged = analytics.organization.metrics.prsMerged;

    expect(prsCreated.current).toBe(primaryCreation.current.length);
    expect(prsCreated.previous).toBe(primaryCreation.previous.length);
    expect(prsMerged.current).toBe(primaryMerges.current.length);
    expect(prsMerged.previous).toBe(primaryMerges.previous.length);

    const historyCreated = analytics.organization.metricHistory.prsCreated;
    const historyMerged = analytics.organization.metricHistory.prsMerged;

    const historyCreatedMap = Object.fromEntries(
      historyCreated.map((entry) => [entry.period, entry.value]),
    );
    expect(historyCreatedMap.previous).toBe(primaryCreation.previous.length);
    expect(historyCreatedMap.current).toBe(primaryCreation.current.length);
    expect(historyCreatedMap.previous2 ?? 0).toBe(0);
    expect(historyCreatedMap.previous3 ?? 0).toBe(0);
    expect(historyCreatedMap.previous4 ?? 0).toBe(0);

    const historyMergedMap = Object.fromEntries(
      historyMerged.map((entry) => [entry.period, entry.value]),
    );
    expect(historyMergedMap.previous).toBe(primaryMerges.previous.length);
    expect(historyMergedMap.current).toBe(primaryMerges.current.length);
    expect(historyMergedMap.previous2 ?? 0).toBe(0);
    expect(historyMergedMap.previous3 ?? 0).toBe(0);
    expect(historyMergedMap.previous4 ?? 0).toBe(0);

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "PR 생성",
          metric: prsCreated,
          format: "count",
          history: toCardHistory(historyCreated),
        }),
        createElement(MetricCard, {
          title: "PR 머지",
          metric: prsMerged,
          format: "count",
          history: toCardHistory(historyMerged),
        }),
      ),
    );

    const creationCard = screen
      .getByText("PR 생성")
      .closest('[data-slot="card"]');
    const mergeCard = screen.getByText("PR 머지").closest('[data-slot="card"]');

    if (!creationCard || !mergeCard) {
      throw new Error("filtered metric cards not found");
    }

    const creationPercent = prsCreated.percentChange;
    const creationPercentLabel =
      creationPercent == null
        ? "–"
        : `${creationPercent >= 0 ? "+" : ""}${creationPercent.toFixed(1)}%`;
    const creationChangeLabel = `${
      prsCreated.absoluteChange >= 0 ? "+" : ""
    }${formatNumber(prsCreated.absoluteChange)} (${creationPercentLabel})`;
    expect(
      within(creationCard as HTMLElement).getByText(creationChangeLabel),
    ).toBeInTheDocument();

    const mergePercent = prsMerged.percentChange;
    const mergePercentLabel =
      mergePercent == null
        ? "–"
        : `${mergePercent >= 0 ? "+" : ""}${mergePercent.toFixed(1)}%`;
    const mergeChangeLabel = `${
      prsMerged.absoluteChange >= 0 ? "+" : ""
    }${formatNumber(prsMerged.absoluteChange)} (${mergePercentLabel})`;
    expect(
      within(mergeCard as HTMLElement).getByText(mergeChangeLabel),
    ).toBeInTheDocument();
  });
});
