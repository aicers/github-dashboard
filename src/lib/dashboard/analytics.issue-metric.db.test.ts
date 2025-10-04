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

const CURRENT_RANGE_START = "2024-01-01T00:00:00.000Z";
const CURRENT_RANGE_END = "2024-01-07T23:59:59.999Z";

async function insertIssue(issue: DbIssue) {
  await upsertIssue(issue);
}

describe("analytics issue metrics", () => {
  beforeEach(async () => {
    await query(
      "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users RESTART IDENTITY CASCADE",
    );
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
  });
});
