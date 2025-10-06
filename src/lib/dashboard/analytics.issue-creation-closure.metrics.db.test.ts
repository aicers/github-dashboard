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
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import {
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  resetDashboardTables,
} from "../../../tests/helpers/dashboard-metrics";

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

async function insertIssue(issue: DbIssue) {
  await upsertIssue(issue);
}

describe("analytics issue metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("builds issue creation metrics with five-period history", async () => {
    const actor: DbActor = {
      id: "user-1",
      login: "octocat",
      name: "Octo Cat",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "repo-1",
      name: "analytics-repo",
      nameWithOwner: "octo/analytics-repo",
      ownerId: actor.id,
      raw: { id: "repo-1" },
    };
    await upsertRepository(repository);

    let issueNumber = 1;
    const makeIssue = ({
      id,
      createdAt,
      closedAt,
      state,
    }: {
      id: string;
      createdAt: string;
      closedAt?: string | null;
      state?: DbIssue["state"];
    }): DbIssue => {
      const resolvedClosedAt = closedAt ?? null;
      const resolvedState = state ?? (resolvedClosedAt ? "CLOSED" : "OPEN");
      const updatedAt = resolvedClosedAt ?? createdAt;
      return {
        id,
        number: issueNumber++,
        repositoryId: repository.id,
        authorId: actor.id,
        title: id,
        state: resolvedState,
        createdAt,
        updatedAt,
        closedAt: resolvedClosedAt,
        raw: { title: id },
      };
    };

    const creationGroups = {
      previous4: [
        "2023-12-04T10:00:00.000Z",
        "2023-12-05T11:30:00.000Z",
        "2023-12-06T14:45:00.000Z",
        "2023-12-08T09:15:00.000Z",
        "2023-12-09T16:20:00.000Z",
      ],
      previous3: ["2023-12-13T12:00:00.000Z"],
      previous2: [
        "2023-12-19T08:00:00.000Z",
        "2023-12-21T15:30:00.000Z",
        "2023-12-23T19:45:00.000Z",
      ],
      previous: ["2023-12-26T11:00:00.000Z", "2023-12-30T13:30:00.000Z"],
      current: [
        "2024-01-01T09:00:00.000Z",
        "2024-01-03T10:15:00.000Z",
        "2024-01-05T14:45:00.000Z",
        "2024-01-07T18:30:00.000Z",
      ],
    } as const;

    const issues: DbIssue[] = [];
    (
      Object.entries(creationGroups) as Array<
        [keyof typeof creationGroups, readonly string[]]
      >
    ).forEach(([period, timestamps]) => {
      timestamps.forEach((createdAt, index) => {
        issues.push(
          makeIssue({
            id: `issue-${period}-${index + 1}`,
            createdAt,
          }),
        );
      });
    });

    issues.push(
      makeIssue({
        id: "issue-outside-created",
        createdAt: "2023-11-15T12:00:00.000Z",
      }),
    );

    for (const issue of issues) {
      await insertIssue(issue);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const issuesCreated = analytics.organization.metrics.issuesCreated;
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

    expect(issuesCreated.current).toBe(expectedHistory.current);
    expect(issuesCreated.previous).toBe(expectedHistory.previous);
    expect(issuesCreated.absoluteChange).toBe(expectedAbsoluteChange);
    expect(issuesCreated.percentChange).not.toBeNull();
    expect(issuesCreated.percentChange ?? 0).toBeCloseTo(
      expectedPercentChange,
      5,
    );

    const history = analytics.organization.metricHistory.issuesCreated;
    expect(history).toEqual([
      { period: "previous4", value: expectedHistory.previous4 },
      { period: "previous3", value: expectedHistory.previous3 },
      { period: "previous2", value: expectedHistory.previous2 },
      { period: "previous", value: expectedHistory.previous },
      { period: "current", value: expectedHistory.current },
    ]);

    const metricTitle = "이슈 생성";
    render(
      createElement(MetricCard, {
        title: metricTitle,
        metric: issuesCreated,
        format: "count",
        history: toCardHistory(history),
      }),
    );

    expect(screen.getByText(metricTitle)).toBeInTheDocument();
    const card = screen.getByText(metricTitle).closest('[data-slot="card"]');
    if (!card) {
      throw new Error("creation metric card not found");
    }
    const cardElement = card as HTMLElement;

    expect(
      within(cardElement).getByText(formatNumber(expectedHistory.current)),
    ).toBeInTheDocument();

    const percent = issuesCreated.percentChange;
    const percentLabel =
      percent == null
        ? "–"
        : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
    const changeLabel = `${
      expectedAbsoluteChange >= 0 ? "+" : ""
    }${formatNumber(expectedAbsoluteChange)} (${percentLabel})`;
    expect(within(cardElement).getByText(changeLabel)).toBeInTheDocument();
  });

  it("builds issue closure metrics with five-period history", async () => {
    const actor: DbActor = {
      id: "user-2",
      login: "octolead",
      name: "Octo Lead",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "repo-2",
      name: "closure-repo",
      nameWithOwner: "octo/closure-repo",
      ownerId: actor.id,
      raw: { id: "repo-2" },
    };
    await upsertRepository(repository);

    let issueNumber = 100;
    const makeIssue = ({
      id,
      createdAt,
      closedAt,
      state,
    }: {
      id: string;
      createdAt: string;
      closedAt?: string | null;
      state?: DbIssue["state"];
    }): DbIssue => {
      const resolvedClosedAt = closedAt ?? null;
      const resolvedState = state ?? (resolvedClosedAt ? "CLOSED" : "OPEN");
      const updatedAt = resolvedClosedAt ?? createdAt;
      return {
        id,
        number: issueNumber++,
        repositoryId: repository.id,
        authorId: actor.id,
        title: id,
        state: resolvedState,
        createdAt,
        updatedAt,
        closedAt: resolvedClosedAt,
        raw: { title: id },
      };
    };

    const closureGroups = {
      previous4: [
        {
          createdAt: "2023-12-01T09:00:00.000Z",
          closedAt: "2023-12-06T12:00:00.000Z",
        },
      ],
      previous3: [
        {
          createdAt: "2023-12-05T10:00:00.000Z",
          closedAt: "2023-12-11T11:30:00.000Z",
        },
        {
          createdAt: "2023-12-10T08:00:00.000Z",
          closedAt: "2023-12-16T15:45:00.000Z",
        },
      ],
      previous2: [
        {
          createdAt: "2023-12-14T07:00:00.000Z",
          closedAt: "2023-12-19T09:15:00.000Z",
        },
        {
          createdAt: "2023-12-15T11:00:00.000Z",
          closedAt: "2023-12-21T10:30:00.000Z",
        },
        {
          createdAt: "2023-12-17T18:00:00.000Z",
          closedAt: "2023-12-23T18:05:00.000Z",
        },
      ],
      previous: [
        {
          createdAt: "2023-12-20T09:00:00.000Z",
          closedAt: "2023-12-26T11:00:00.000Z",
        },
        {
          createdAt: "2023-12-24T12:30:00.000Z",
          closedAt: "2023-12-28T14:30:00.000Z",
        },
        {
          createdAt: "2023-12-26T07:45:00.000Z",
          closedAt: "2023-12-30T09:45:00.000Z",
        },
        {
          createdAt: "2023-12-27T16:15:00.000Z",
          closedAt: "2023-12-31T16:15:00.000Z",
        },
      ],
      current: [
        {
          createdAt: "2023-12-29T08:00:00.000Z",
          closedAt: "2024-01-02T08:00:00.000Z",
        },
        {
          createdAt: "2023-12-30T13:00:00.000Z",
          closedAt: "2024-01-03T13:00:00.000Z",
        },
        {
          createdAt: "2023-12-31T17:30:00.000Z",
          closedAt: "2024-01-04T17:30:00.000Z",
        },
        {
          createdAt: "2024-01-02T09:15:00.000Z",
          closedAt: "2024-01-06T09:15:00.000Z",
        },
        {
          createdAt: "2024-01-03T18:45:00.000Z",
          closedAt: "2024-01-07T18:45:00.000Z",
        },
      ],
    } as const;

    const issues: DbIssue[] = [];
    (
      Object.entries(closureGroups) as Array<
        [
          keyof typeof closureGroups,
          readonly { createdAt: string; closedAt: string }[],
        ]
      >
    ).forEach(([period, entries]) => {
      entries.forEach((entry, index) => {
        issues.push(
          makeIssue({
            id: `issue-${period}-closed-${index + 1}`,
            createdAt: entry.createdAt,
            closedAt: entry.closedAt,
          }),
        );
      });
    });

    issues.push(
      makeIssue({
        id: "issue-closed-outside",
        createdAt: "2023-10-01T10:00:00.000Z",
        closedAt: "2023-11-15T12:00:00.000Z",
      }),
    );

    issues.push(
      makeIssue({
        id: "issue-still-open-current",
        createdAt: "2024-01-05T08:00:00.000Z",
        closedAt: null,
        state: "OPEN",
      }),
    );

    for (const issue of issues) {
      await insertIssue(issue);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const issuesClosed = analytics.organization.metrics.issuesClosed;
    const expectedHistory = {
      previous4: closureGroups.previous4.length,
      previous3: closureGroups.previous3.length,
      previous2: closureGroups.previous2.length,
      previous: closureGroups.previous.length,
      current: closureGroups.current.length,
    } as const;

    const expectedAbsoluteChange =
      expectedHistory.current - expectedHistory.previous;
    const expectedPercentChange =
      (expectedAbsoluteChange / expectedHistory.previous) * 100;

    expect(issuesClosed.current).toBe(expectedHistory.current);
    expect(issuesClosed.previous).toBe(expectedHistory.previous);
    expect(issuesClosed.absoluteChange).toBe(expectedAbsoluteChange);
    expect(issuesClosed.percentChange).not.toBeNull();
    expect(issuesClosed.percentChange ?? 0).toBeCloseTo(
      expectedPercentChange,
      5,
    );

    const history = analytics.organization.metricHistory.issuesClosed;
    expect(history).toEqual([
      { period: "previous4", value: expectedHistory.previous4 },
      { period: "previous3", value: expectedHistory.previous3 },
      { period: "previous2", value: expectedHistory.previous2 },
      { period: "previous", value: expectedHistory.previous },
      { period: "current", value: expectedHistory.current },
    ]);

    const metricTitle = "이슈 종료";
    render(
      createElement(MetricCard, {
        title: metricTitle,
        metric: issuesClosed,
        format: "count",
        history: toCardHistory(history),
      }),
    );

    expect(screen.getByText(metricTitle)).toBeInTheDocument();
    const card = screen.getByText(metricTitle).closest('[data-slot="card"]');
    if (!card) {
      throw new Error("closure metric card not found");
    }
    const cardElement = card as HTMLElement;

    expect(
      within(cardElement).getByText(formatNumber(expectedHistory.current)),
    ).toBeInTheDocument();

    const percent = issuesClosed.percentChange;
    const percentLabel =
      percent == null
        ? "–"
        : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
    const changeLabel = `${
      expectedAbsoluteChange >= 0 ? "+" : ""
    }${formatNumber(expectedAbsoluteChange)} (${percentLabel})`;
    expect(within(cardElement).getByText(changeLabel)).toBeInTheDocument();
  });

  it("handles decreasing issue creation and closure counts", async () => {
    const actor: DbActor = {
      id: "user-regression",
      login: "regression-user",
      name: "Regression User",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "repo-regression",
      name: "regression-repo",
      nameWithOwner: "octo/regression-repo",
      ownerId: actor.id,
      raw: { id: "repo-regression" },
    };
    await upsertRepository(repository);

    let issueNumber = 1000;
    const makeIssue = ({
      id,
      createdAt,
      closedAt,
      state,
    }: {
      id: string;
      createdAt: string;
      closedAt?: string | null;
      state?: DbIssue["state"];
    }): DbIssue => {
      const resolvedClosedAt = closedAt ?? null;
      const resolvedState = state ?? (resolvedClosedAt ? "CLOSED" : "OPEN");
      const updatedAt = resolvedClosedAt ?? createdAt;
      return {
        id,
        number: issueNumber++,
        repositoryId: repository.id,
        authorId: actor.id,
        title: id,
        state: resolvedState,
        createdAt,
        updatedAt,
        closedAt: resolvedClosedAt,
        raw: { title: id },
      };
    };

    const previousCreationTimes = [
      "2023-12-26T09:00:00.000Z",
      "2023-12-27T10:00:00.000Z",
      "2023-12-29T11:30:00.000Z",
    ];
    const currentCreationTimes = [
      "2024-01-02T09:15:00.000Z",
      "2024-01-04T10:45:00.000Z",
    ];

    for (let index = 0; index < previousCreationTimes.length; index += 1) {
      const createdAt = previousCreationTimes[index];
      await insertIssue(
        makeIssue({
          id: `regression-created-previous-${index + 1}`,
          createdAt,
        }),
      );
    }

    for (let index = 0; index < currentCreationTimes.length; index += 1) {
      const createdAt = currentCreationTimes[index];
      await insertIssue(
        makeIssue({
          id: `regression-created-current-${index + 1}`,
          createdAt,
        }),
      );
    }

    const closureBuckets = {
      previous: [
        {
          createdAt: "2023-11-01T09:00:00.000Z",
          closedAt: "2023-12-27T12:00:00.000Z",
        },
        {
          createdAt: "2023-11-02T08:30:00.000Z",
          closedAt: "2023-12-28T13:00:00.000Z",
        },
        {
          createdAt: "2023-11-03T10:00:00.000Z",
          closedAt: "2023-12-30T14:15:00.000Z",
        },
      ],
      current: [
        {
          createdAt: "2023-11-10T09:00:00.000Z",
          closedAt: "2024-01-03T12:30:00.000Z",
        },
        {
          createdAt: "2023-11-11T11:00:00.000Z",
          closedAt: "2024-01-05T11:30:00.000Z",
        },
      ],
    } as const;

    for (const [period, entries] of Object.entries(closureBuckets) as Array<
      [
        "previous" | "current",
        readonly { createdAt: string; closedAt: string }[],
      ]
    >) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        await insertIssue(
          makeIssue({
            id: `regression-closed-${period}-${index + 1}`,
            createdAt: entry.createdAt,
            closedAt: entry.closedAt,
          }),
        );
      }
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const issuesCreated = analytics.organization.metrics.issuesCreated;
    const issuesClosed = analytics.organization.metrics.issuesClosed;

    const expectedCreatedCurrent = currentCreationTimes.length;
    const expectedCreatedPrevious = previousCreationTimes.length;
    const expectedCreatedAbsolute =
      expectedCreatedCurrent - expectedCreatedPrevious;
    const expectedCreatedPercent =
      (expectedCreatedAbsolute / expectedCreatedPrevious) * 100;

    expect(issuesCreated.current).toBe(expectedCreatedCurrent);
    expect(issuesCreated.previous).toBe(expectedCreatedPrevious);
    expect(issuesCreated.absoluteChange).toBe(expectedCreatedAbsolute);
    expect(issuesCreated.percentChange).not.toBeNull();
    expect(issuesCreated.percentChange ?? 0).toBeCloseTo(
      expectedCreatedPercent,
      5,
    );

    const expectedClosedCurrent = closureBuckets.current.length;
    const expectedClosedPrevious = closureBuckets.previous.length;
    const expectedClosedAbsolute =
      expectedClosedCurrent - expectedClosedPrevious;
    const expectedClosedPercent =
      (expectedClosedAbsolute / expectedClosedPrevious) * 100;

    expect(issuesClosed.current).toBe(expectedClosedCurrent);
    expect(issuesClosed.previous).toBe(expectedClosedPrevious);
    expect(issuesClosed.absoluteChange).toBe(expectedClosedAbsolute);
    expect(issuesClosed.percentChange).not.toBeNull();
    expect(issuesClosed.percentChange ?? 0).toBeCloseTo(
      expectedClosedPercent,
      5,
    );

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "이슈 생성",
          metric: issuesCreated,
          format: "count",
        }),
        createElement(MetricCard, {
          title: "이슈 종료",
          metric: issuesClosed,
          format: "count",
        }),
      ),
    );

    const creationCard = screen
      .getByText("이슈 생성")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const closureCard = screen
      .getByText("이슈 종료")
      .closest('[data-slot="card"]') as HTMLElement | null;

    if (!creationCard || !closureCard) {
      throw new Error("regression cards not found");
    }

    const creationPercent = issuesCreated.percentChange;
    const creationPercentLabel =
      creationPercent == null
        ? "–"
        : `${creationPercent >= 0 ? "+" : ""}${creationPercent.toFixed(1)}%`;
    const creationChangeLabel = `${issuesCreated.absoluteChange >= 0 ? "+" : ""}${formatNumber(
      issuesCreated.absoluteChange,
    )} (${creationPercentLabel})`;
    expect(
      within(creationCard).getByText(formatNumber(expectedCreatedCurrent)),
    ).toBeInTheDocument();
    expect(
      within(creationCard).getByText(creationChangeLabel),
    ).toBeInTheDocument();

    const closedPercent = issuesClosed.percentChange;
    const closedPercentLabel =
      closedPercent == null
        ? "–"
        : `${closedPercent >= 0 ? "+" : ""}${closedPercent.toFixed(1)}%`;
    const closedChangeLabel = `${issuesClosed.absoluteChange >= 0 ? "+" : ""}${formatNumber(
      issuesClosed.absoluteChange,
    )} (${closedPercentLabel})`;
    expect(
      within(closureCard).getByText(formatNumber(expectedClosedCurrent)),
    ).toBeInTheDocument();
    expect(
      within(closureCard).getByText(closedChangeLabel),
    ).toBeInTheDocument();
  });

  it("treats zero baseline counts as having no percent change", async () => {
    const actor: DbActor = {
      id: "user-zero-baseline",
      login: "zero-baseline-user",
      name: "Zero Baseline",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "repo-zero-baseline",
      name: "zero-baseline-repo",
      nameWithOwner: "octo/zero-baseline-repo",
      ownerId: actor.id,
      raw: { id: "repo-zero-baseline" },
    };
    await upsertRepository(repository);

    let issueNumber = 2000;
    const makeIssue = ({
      id,
      createdAt,
      closedAt,
      state,
    }: {
      id: string;
      createdAt: string;
      closedAt?: string | null;
      state?: DbIssue["state"];
    }): DbIssue => {
      const resolvedClosedAt = closedAt ?? null;
      const resolvedState = state ?? (resolvedClosedAt ? "CLOSED" : "OPEN");
      const updatedAt = resolvedClosedAt ?? createdAt;
      return {
        id,
        number: issueNumber++,
        repositoryId: repository.id,
        authorId: actor.id,
        title: id,
        state: resolvedState,
        createdAt,
        updatedAt,
        closedAt: resolvedClosedAt,
        raw: { title: id },
      };
    };

    const currentCreationTimes = [
      "2024-01-02T10:00:00.000Z",
      "2024-01-06T16:30:00.000Z",
    ];

    for (let index = 0; index < currentCreationTimes.length; index += 1) {
      const createdAt = currentCreationTimes[index];
      await insertIssue(
        makeIssue({
          id: `zero-baseline-created-${index + 1}`,
          createdAt,
        }),
      );
    }

    const currentClosures = [
      {
        createdAt: "2023-11-10T09:00:00.000Z",
        closedAt: "2024-01-03T12:00:00.000Z",
      },
      {
        createdAt: "2023-11-11T11:00:00.000Z",
        closedAt: "2024-01-06T15:00:00.000Z",
      },
    ] as const;

    for (let index = 0; index < currentClosures.length; index += 1) {
      const entry = currentClosures[index];
      await insertIssue(
        makeIssue({
          id: `zero-baseline-closed-${index + 1}`,
          createdAt: entry.createdAt,
          closedAt: entry.closedAt,
        }),
      );
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const issuesCreated = analytics.organization.metrics.issuesCreated;
    const issuesClosed = analytics.organization.metrics.issuesClosed;

    expect(issuesCreated.previous).toBe(0);
    expect(issuesCreated.current).toBe(currentCreationTimes.length);
    expect(issuesCreated.absoluteChange).toBe(currentCreationTimes.length);
    expect(issuesCreated.percentChange).toBeNull();

    expect(issuesClosed.previous).toBe(0);
    expect(issuesClosed.current).toBe(currentClosures.length);
    expect(issuesClosed.absoluteChange).toBe(currentClosures.length);
    expect(issuesClosed.percentChange).toBeNull();

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "이슈 생성",
          metric: issuesCreated,
          format: "count",
          history: toCardHistory(
            analytics.organization.metricHistory.issuesCreated,
          ),
        }),
        createElement(MetricCard, {
          title: "이슈 종료",
          metric: issuesClosed,
          format: "count",
          history: toCardHistory(
            analytics.organization.metricHistory.issuesClosed,
          ),
        }),
      ),
    );

    const creationCard = screen
      .getByText("이슈 생성")
      .closest('[data-slot="card"]') as HTMLElement | null;
    const closureCard = screen
      .getByText("이슈 종료")
      .closest('[data-slot="card"]') as HTMLElement | null;

    if (!creationCard || !closureCard) {
      throw new Error("zero baseline metric cards not found");
    }

    const creationChangeLabel = `${issuesCreated.absoluteChange >= 0 ? "+" : ""}${formatNumber(
      issuesCreated.absoluteChange,
    )} (–)`;
    expect(
      within(creationCard).getByText(creationChangeLabel),
    ).toBeInTheDocument();

    const closureChangeLabel = `${issuesClosed.absoluteChange >= 0 ? "+" : ""}${formatNumber(
      issuesClosed.absoluteChange,
    )} (–)`;
    expect(
      within(closureCard).getByText(closureChangeLabel),
    ).toBeInTheDocument();
  });

  it("excludes other repositories when a filter is provided", async () => {
    const actor: DbActor = {
      id: "user-repo-filter",
      login: "repo-filter-user",
      name: "Repo Filter",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const primaryRepository: DbRepository = {
      id: "repo-filter-primary",
      name: "filter-primary",
      nameWithOwner: "octo/filter-primary",
      ownerId: actor.id,
      raw: { id: "repo-filter-primary" },
    };
    await upsertRepository(primaryRepository);

    const secondaryRepository: DbRepository = {
      id: "repo-filter-secondary",
      name: "filter-secondary",
      nameWithOwner: "octo/filter-secondary",
      ownerId: actor.id,
      raw: { id: "repo-filter-secondary" },
    };
    await upsertRepository(secondaryRepository);

    const createFactory = (repository: DbRepository, startNumber: number) => {
      let localNumber = startNumber;
      return ({
        id,
        createdAt,
        closedAt,
        state,
      }: {
        id: string;
        createdAt: string;
        closedAt?: string | null;
        state?: DbIssue["state"];
      }): DbIssue => {
        const resolvedClosedAt = closedAt ?? null;
        const resolvedState = state ?? (resolvedClosedAt ? "CLOSED" : "OPEN");
        const updatedAt = resolvedClosedAt ?? createdAt;
        return {
          id,
          number: localNumber++,
          repositoryId: repository.id,
          authorId: actor.id,
          title: id,
          state: resolvedState,
          createdAt,
          updatedAt,
          closedAt: resolvedClosedAt,
          raw: { title: id },
        };
      };
    };

    const makePrimaryIssue = createFactory(primaryRepository, 3000);
    const makeSecondaryIssue = createFactory(secondaryRepository, 4000);

    const primaryCreation = {
      previous: ["2023-12-27T09:00:00.000Z"],
      current: ["2024-01-02T09:30:00.000Z", "2024-01-06T17:45:00.000Z"],
    } as const;

    for (let index = 0; index < primaryCreation.previous.length; index += 1) {
      await insertIssue(
        makePrimaryIssue({
          id: `filter-primary-created-previous-${index + 1}`,
          createdAt: primaryCreation.previous[index],
        }),
      );
    }

    for (let index = 0; index < primaryCreation.current.length; index += 1) {
      await insertIssue(
        makePrimaryIssue({
          id: `filter-primary-created-current-${index + 1}`,
          createdAt: primaryCreation.current[index],
        }),
      );
    }

    const primaryClosures = {
      previous: [
        {
          createdAt: "2023-11-01T09:00:00.000Z",
          closedAt: "2023-12-28T10:00:00.000Z",
        },
      ],
      current: [
        {
          createdAt: "2023-11-08T08:00:00.000Z",
          closedAt: "2024-01-04T08:00:00.000Z",
        },
      ],
    } as const;

    for (const [period, entries] of Object.entries(primaryClosures) as Array<
      [
        "previous" | "current",
        readonly { createdAt: string; closedAt: string }[],
      ]
    >) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        await insertIssue(
          makePrimaryIssue({
            id: `filter-primary-closed-${period}-${index + 1}`,
            createdAt: entry.createdAt,
            closedAt: entry.closedAt,
          }),
        );
      }
    }

    const secondaryCreation = {
      previous: ["2023-12-26T12:00:00.000Z", "2023-12-28T15:00:00.000Z"],
      current: [
        "2024-01-01T09:00:00.000Z",
        "2024-01-03T10:30:00.000Z",
        "2024-01-05T14:00:00.000Z",
      ],
    } as const;

    for (let index = 0; index < secondaryCreation.previous.length; index += 1) {
      await insertIssue(
        makeSecondaryIssue({
          id: `filter-secondary-created-previous-${index + 1}`,
          createdAt: secondaryCreation.previous[index],
        }),
      );
    }

    for (let index = 0; index < secondaryCreation.current.length; index += 1) {
      await insertIssue(
        makeSecondaryIssue({
          id: `filter-secondary-created-current-${index + 1}`,
          createdAt: secondaryCreation.current[index],
        }),
      );
    }

    const secondaryClosures = {
      previous: [
        {
          createdAt: "2023-11-01T07:00:00.000Z",
          closedAt: "2023-12-27T12:00:00.000Z",
        },
        {
          createdAt: "2023-11-02T09:30:00.000Z",
          closedAt: "2023-12-30T11:30:00.000Z",
        },
      ],
      current: [
        {
          createdAt: "2023-11-08T08:00:00.000Z",
          closedAt: "2024-01-02T09:00:00.000Z",
        },
        {
          createdAt: "2023-11-09T10:00:00.000Z",
          closedAt: "2024-01-04T10:00:00.000Z",
        },
        {
          createdAt: "2023-11-10T12:00:00.000Z",
          closedAt: "2024-01-06T13:30:00.000Z",
        },
      ],
    } as const;

    for (const [period, entries] of Object.entries(secondaryClosures) as Array<
      [
        "previous" | "current",
        readonly { createdAt: string; closedAt: string }[],
      ]
    >) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        await insertIssue(
          makeSecondaryIssue({
            id: `filter-secondary-closed-${period}-${index + 1}`,
            createdAt: entry.createdAt,
            closedAt: entry.closedAt,
          }),
        );
      }
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      repositoryIds: [primaryRepository.id],
    });

    const issuesCreated = analytics.organization.metrics.issuesCreated;
    const issuesClosed = analytics.organization.metrics.issuesClosed;

    expect(issuesCreated.current).toBe(primaryCreation.current.length);
    expect(issuesCreated.previous).toBe(primaryCreation.previous.length);
    expect(issuesClosed.current).toBe(primaryClosures.current.length);
    expect(issuesClosed.previous).toBe(primaryClosures.previous.length);

    const historyCreated = analytics.organization.metricHistory.issuesCreated;
    const historyClosed = analytics.organization.metricHistory.issuesClosed;

    const historyMapCreated = Object.fromEntries(
      historyCreated.map((entry) => [entry.period, entry.value]),
    );
    expect(historyMapCreated.previous).toBe(primaryCreation.previous.length);
    expect(historyMapCreated.current).toBe(primaryCreation.current.length);
    expect(historyMapCreated.previous2 ?? 0).toBe(0);
    expect(historyMapCreated.previous3 ?? 0).toBe(0);
    expect(historyMapCreated.previous4 ?? 0).toBe(0);

    const historyMapClosed = Object.fromEntries(
      historyClosed.map((entry) => [entry.period, entry.value]),
    );
    expect(historyMapClosed.previous).toBe(primaryClosures.previous.length);
    expect(historyMapClosed.current).toBe(primaryClosures.current.length);
    expect(historyMapClosed.previous2 ?? 0).toBe(0);
    expect(historyMapClosed.previous3 ?? 0).toBe(0);
    expect(historyMapClosed.previous4 ?? 0).toBe(0);

    render(
      createElement(
        "div",
        null,
        createElement(MetricCard, {
          title: "이슈 생성",
          metric: issuesCreated,
          format: "count",
          history: toCardHistory(historyCreated),
        }),
        createElement(MetricCard, {
          title: "이슈 종료",
          metric: issuesClosed,
          format: "count",
          history: toCardHistory(historyClosed),
        }),
      ),
    );

    const creationPercent = issuesCreated.percentChange;
    const creationPercentLabel =
      creationPercent == null
        ? "–"
        : `${creationPercent >= 0 ? "+" : ""}${creationPercent.toFixed(1)}%`;
    const creationChangeLabel = `${issuesCreated.absoluteChange >= 0 ? "+" : ""}${formatNumber(
      issuesCreated.absoluteChange,
    )} (${creationPercentLabel})`;

    const closurePercent = issuesClosed.percentChange;
    const closurePercentLabel =
      closurePercent == null
        ? "–"
        : `${closurePercent >= 0 ? "+" : ""}${closurePercent.toFixed(1)}%`;
    const closureChangeLabel = `${issuesClosed.absoluteChange >= 0 ? "+" : ""}${formatNumber(
      issuesClosed.absoluteChange,
    )} (${closurePercentLabel})`;

    const creationCard = screen
      .getByText("이슈 생성")
      .closest('[data-slot="card"]');
    const closureCard = screen
      .getByText("이슈 종료")
      .closest('[data-slot="card"]');

    if (!creationCard || !closureCard) {
      throw new Error("filtered metric cards not found");
    }

    expect(
      within(creationCard as HTMLElement).getByText(creationChangeLabel),
    ).toBeInTheDocument();
    expect(
      within(closureCard as HTMLElement).getByText(closureChangeLabel),
    ).toBeInTheDocument();
  });
});
